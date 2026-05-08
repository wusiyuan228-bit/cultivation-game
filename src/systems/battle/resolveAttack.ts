/**
 * 攻击结算 7-phase Hook 主流程
 *
 * 严格对齐契约 §3：
 *   Phase 1 : on_before_roll           攻方改骰数
 *   Phase 2 : on_before_defend_roll    守方改骰数
 *   Phase 3 : dice_roll_*              投骰 + on_after_attack_roll
 *   Phase 4 : on_before_being_attacked 守方减骰/免疫
 *   Phase 5 : on_damage_calc           双向修饰
 *             damage_applied           落实
 *   Phase 6 : on_after_being_hit       守方反伤
 *             on_after_hit             攻方吞噬/吸血
 *   Phase 7 : unit_leave / on_kill 等  退场与后续钩子
 *
 * §3.11 钩子递归防护：hookFiredSet 同一次攻击内去重
 * §5.1 同 phase 多 modifier 的结算顺序
 * §3.2 最低伤害规则（MIN_ATTACK_DAMAGE=1）
 */

import {
  type AttackContext,
  type BattleUnit,
  type HookHandler,
  type HookName,
  type IBattleEngine,
  type LogEntry,
  MIN_ATTACK_DAMAGE,
} from './types';
import { SkillRegistry } from './skillRegistry';

/** 克制关系：剑→妖→体→灵→法→剑，丹修中立 */
const COUNTER_MAP: Record<string, string> = {
  剑修: '妖修',
  妖修: '体修',
  体修: '灵修',
  灵修: '法修',
  法修: '剑修',
};

function isCounter(attackerType: string, defenderType: string): boolean {
  return COUNTER_MAP[attackerType] === defenderType;
}

/** 3 面骰（0/1/2）*/
function rollDice(count: number): number[] {
  const result: number[] = [];
  const n = Math.max(1, count);
  for (let i = 0; i < n; i++) result.push(Math.floor(Math.random() * 3));
  return result;
}

function sum(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0);
}

/**
 * 收集某单位上所有 hook，合并其 skills 列表里对应的 hook handler
 * （注意：这里从 SkillRegistry 里按 unit.skills 逐个查 skill 的 hooks）
 *
 * 【压制机制 · 厉飞雨·疾风无影】
 * 若 ctx.suppressAttackerBattleSkill === true 且当前 unit 为攻方，
 * 则"被动 battle_skill"（isActive !== true 且 kind !== 'ultimate' | 'awaken_ult'）的 hook
 * 将被跳过，不被收集。绝技与觉醒绝技不受影响。
 */
function collectHooks(
  unit: BattleUnit,
  hookName: HookName,
  ctx?: AttackContext,
): HookHandler[] {
  const result: HookHandler[] = [];
  const suppressAttackerBattle =
    !!ctx && (ctx as unknown as Record<string, unknown>).suppressAttackerBattleSkill === true;
  const isAttacker = !!ctx && unit.id === ctx.attacker.id;
  for (const skillId of unit.skills) {
    const skill = SkillRegistry.get(skillId);
    if (!skill) continue;
    const handler = skill.hooks[hookName];
    if (!handler) continue;
    // 厉飞雨·疾风无影压制：仅屏蔽攻方的"被动 battle_skill"hook
    if (suppressAttackerBattle && isAttacker) {
      const kind =
        skill.kind ?? (skill.isActive === true ? 'ultimate' : 'battle_skill');
      const isPassiveBattle = kind === 'battle_skill' || kind === 'awaken_skill';
      if (isPassiveBattle) {
        // 跳过该 hook（同时留下一次 emit，让战报显示"被屏蔽"）
        continue;
      }
    }
    result.push(handler as HookHandler);
  }
  return result;
}

/** 按契约 §3.11，同一次攻击内每个 (unitId, hookName) 只触发 1 次 */
function fireHooksOf(
  unit: BattleUnit,
  hookName: HookName,
  ctx: AttackContext,
  engine: IBattleEngine,
): void {
  const key = `${unit.id}::${hookName}`;
  if (ctx.hookFiredSet.has(key)) return;
  ctx.hookFiredSet.add(key);
  const hooks = collectHooks(unit, hookName, ctx);
  // BUGFIX（2026-05-01）：统一注入"当前 fire 的持有者身份"标记，
  // 避免 on_damage_calc 等双向 hook 误把"对方攻击自己"识别为"自己进攻对方"。
  // 技能 handler 应优先读取 __firingUnitId__ / __firingUnitIsAttacker__ 做身份判断。
  (ctx as any).__firingUnitId__ = unit.id;
  (ctx as any).__firingUnitIsAttacker__ = unit.id === ctx.attacker.id;
  for (const h of hooks) {
    try {
      h(ctx, engine);
    } catch (e) {
      console.error(`[Engine] hook ${hookName} on ${unit.name} threw:`, e);
    }
  }
  (ctx as any).__firingUnitId__ = undefined;
  (ctx as any).__firingUnitIsAttacker__ = undefined;
}

/* ============================================================== */
/*  主函数                                                          */
/* ============================================================== */

export interface AttackOptions {
  /** 是否为绝技攻击 */
  viaUltimate?: boolean;
  /** 多段攻击时的段号 */
  segmentIndex?: number;
  /** 本次攻击附带的技能 id（主动技挂攻） */
  skillId?: string;
}

export interface AttackResult {
  attackerDice: number[];
  defenderDice: number[];
  aSum: number;
  dSum: number;
  diceAttack: number;
  diceDefend: number;
  damage: number;
  calcLog: Array<{ source: string; delta: number; note: string }>;
  defenderDied: boolean;
  counterBonus: number;
}

export function resolveAttack(
  attackerId: string,
  defenderId: string,
  engine: IBattleEngine,
  opts: AttackOptions = {},
): AttackResult {
  const attacker = engine.getUnit(attackerId);
  const defender = engine.getUnit(defenderId);
  if (!attacker || !defender) {
    throw new Error(`[resolveAttack] unit not found: ${attackerId} vs ${defenderId}`);
  }

  const ctx: AttackContext = {
    attackKind: opts.viaUltimate ? 'skill_damage' : 'basic',
    viaUltimate: !!opts.viaUltimate,
    segmentIndex: opts.segmentIndex ?? 0,
    attacker,
    defender,
    diceAttack: attacker.atk.current,
    diceDefend: defender.atk.current,
    aSum: 0,
    dSum: 0,
    skillId: opts.skillId,
    hookFiredSet: new Set<string>(),
    calcLog: [],
  };

  // ————————————— Phase 1 —————————————
  fireHooksOf(attacker, 'on_before_roll', ctx, engine);

  // ————————————— Phase 2 —————————————
  fireHooksOf(defender, 'on_before_defend_roll', ctx, engine);

  engine.emit(
    'attack_declared',
    {
      attackerId: attacker.id,
      defenderId: defender.id,
      diceAttack: ctx.diceAttack,
      diceDefend: ctx.diceDefend,
      viaUltimate: ctx.viaUltimate,
    },
    `${attacker.name} 攻击 ${defender.name}（${ctx.diceAttack}骰 vs ${ctx.diceDefend}骰）`,
    { actorId: attacker.id, targetIds: [defender.id], severity: 'info' },
  );

  // ————————————— Phase 3 —————————————
  const attackerDice = rollDice(ctx.diceAttack);
  ctx.aSum = sum(attackerDice);
  engine.emit(
    'dice_roll_attack',
    { faces: attackerDice, sum: ctx.aSum, count: ctx.diceAttack },
    `${attacker.name} 掷出 [${attackerDice.join(',')}] = ${ctx.aSum}`,
    { actorId: attacker.id, severity: 'info' },
  );

  // on_after_attack_roll（重投等）
  fireHooksOf(attacker, 'on_after_attack_roll', ctx, engine);

  const defenderDice = rollDice(ctx.diceDefend);
  ctx.dSum = sum(defenderDice);
  engine.emit(
    'dice_roll_defend',
    { faces: defenderDice, sum: ctx.dSum, count: ctx.diceDefend },
    `${defender.name} 掷出 [${defenderDice.join(',')}] = ${ctx.dSum}`,
    { actorId: defender.id, severity: 'info' },
  );

  // ————————————— Phase 4 —————————————
  fireHooksOf(defender, 'on_before_being_attacked', ctx, engine);

  // ————————————— Phase 5 —————————————
  // 先让攻/守双方的 on_damage_calc hook 写入 calcLog
  fireHooksOf(attacker, 'on_damage_calc', ctx, engine);
  fireHooksOf(defender, 'on_damage_calc', ctx, engine);

  // 基础伤害
  let damage = ctx.aSum - ctx.dSum;

  // §5.1 按阶段应用 calcLog 中的条目
  // ① 攻方 + 项（damage_bonus，不含乘法、封顶 marker、最终伤害 marker）
  for (const entry of ctx.calcLog) {
    if (entry.source.endsWith('__multiplier__')) continue;
    if (entry.source.endsWith('__cap__')) continue; // 封顶 marker 只在 ③ 之后处理
    if (entry.source === '__final_damage__') continue;
    damage += entry.delta;
  }
  // 克制关系 +1（视同 damage_bonus，priority 同 TEMPORAL）
  const counterBonus = isCounter(attacker.type, defender.type) ? 1 : 0;
  if (counterBonus) {
    damage += counterBonus;
    ctx.calcLog.push({
      source: '__counter__',
      delta: +1,
      note: `克制关系 +1（${attacker.type}→${defender.type}）`,
    });
  }
  // ③ 翻倍类（噬金虫群等）
  for (const entry of ctx.calcLog) {
    if (entry.source.endsWith('__multiplier__')) {
      damage = damage * entry.delta;
    }
  }
  // ④ 封顶类（无敌金身 / 白虎金身等）—— 取所有 __cap__ entry 中最小的 cap
  for (const entry of ctx.calcLog) {
    if (entry.source.endsWith('__cap__')) {
      damage = Math.min(damage, entry.delta);
    }
  }
  // ⑦ 最低伤害保底
  damage = Math.max(damage, MIN_ATTACK_DAMAGE);

  // 记录最终伤害到 calcLog，供 on_after_hit 读取
  ctx.calcLog.push({
    source: '__final_damage__',
    delta: damage,
    note: `最终伤害 = ${damage}`,
  });

  engine.emit(
    'damage_calc',
    {
      aSum: ctx.aSum,
      dSum: ctx.dSum,
      counterBonus,
      calcLog: ctx.calcLog.filter(
        (e) => !e.source.endsWith('__multiplier__') && e.source !== '__final_damage__',
      ),
      finalDamage: damage,
    },
    `伤害计算：${ctx.aSum} - ${ctx.dSum} = ${ctx.aSum - ctx.dSum}，修正后 = ${damage}`,
    { actorId: attacker.id, targetIds: [defender.id], severity: 'info' },
  );

  // 落实伤害
  engine.changeStat(defender.id, 'hp', -damage, {
    permanent: false,
    reason: '攻击伤害',
  });

  engine.emit(
    'damage_applied',
    { targetId: defender.id, damage, attackerId: attacker.id },
    `${defender.name} 承受 ${damage} 点伤害（剩余气血 ${Math.max(0, defender.hp.current)}）`,
    { actorId: attacker.id, targetIds: [defender.id], severity: 'highlight' },
  );

  // 累计 attacker 的伤害输出统计
  if (damage > 0) {
    attacker.perTurn.damageDealtToOthers += damage;
    attacker.perTurn.didCauseAnyDamage = true;
  }

  // ————————————— Phase 6 —————————————
  // 注意：§3 规定 Phase 6 期间 defender.isAlive 保持 true
  fireHooksOf(defender, 'on_after_being_hit', ctx, engine);
  fireHooksOf(attacker, 'on_after_hit', ctx, engine);

  // ————————————— Phase 7 —————————————
  let defenderDied = false;
  if (defender.hp.current <= 0 && defender.isAlive) {
    defender.isAlive = false;
    defenderDied = true;
    engine.emit(
      'unit_leave',
      { targetId: defender.id, reason: 'death', killerId: attacker.id },
      `💀 ${defender.name} 被击杀！`,
      { actorId: attacker.id, targetIds: [defender.id], severity: 'climax' },
    );
    // on_kill 链
    fireHooksOf(attacker, 'on_kill', ctx, engine);
    // 累计击杀数（供寒立觉醒触发器）
    attacker.killCount = (attacker.killCount ?? 0) + 1;
    // on_any_death / on_any_ally_death / on_self_death 暂不派发（阶段 C 实装）
  }

  return {
    attackerDice,
    defenderDice,
    aSum: ctx.aSum,
    dSum: ctx.dSum,
    diceAttack: ctx.diceAttack,
    diceDefend: ctx.diceDefend,
    damage,
    calcLog: ctx.calcLog,
    defenderDied,
    counterBonus,
  };
}
