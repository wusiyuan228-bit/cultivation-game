/**
 * S7D · 攻击引擎（Batch 2C · 带 hook 链路 + 觉醒扫描）
 *
 * 参考 S7B 的 attack 流程（src/stores/s7bBattleStore.ts 720-920 行）,
 * 把 7 阶段 hook 流程完整移植到 S7D:
 *
 *   Phase 1: on_before_roll        (攻方改骰数)
 *   Phase 2: on_before_defend_roll (防方改骰数)
 *   Phase 3: 滚骰 + on_after_attack_roll
 *   Phase 4: on_before_being_attacked (防方减骰/免疫)
 *   Phase 5: on_damage_calc (双向: 伤害计算修饰)
 *   Phase 6: on_after_being_hit + on_after_hit (反伤/吸血/吞噬/debuff)
 *   Phase 7: unit_leave / on_kill (击杀回调)
 *
 * 并在伤害落实后自动调用 checkAndTriggerAwakening.
 *
 * 模块职责:
 *   - executeAttackWithHooks: 主入口, 纯函数, 接受 state 引用直接变更
 *   - checkAndTriggerAwakening: 觉醒扫描, 每次攻击/技能后自动调用
 */

import type {
  BattleUnit as EngineUnit,
  IBattleEngine,
  AttackContext,
  HookName,
  StatBox,
} from '@/systems/battle/types';
import { SkillRegistry } from '@/systems/battle/skillRegistry';
import { AWAKEN_TRIGGERS } from '@/data/awakeningTriggers';
import { HERO_BLUEPRINTS } from '@/data/heroBlueprints';
import type {
  BattleCardInstance,
  S7DBattleState,
  S7DLogKind,
} from '@/types/s7dBattle';
import { appendLog, killUnit as killS7DUnit } from './s7dBattleActions';
import { isCounter } from '@/stores/battleStore';

// ============================================================================
// 工具: 映射 S7D 卡 → 引擎 EngineUnit (局部 mutable 快照)
// ============================================================================

function mkBox(n: number, initial: number): StatBox {
  return { base: n, current: n, initial };
}

function toEngineUnit(u: BattleCardInstance, playerFaction: 'A' | 'B'): EngineUnit {
  const owner = u.faction === playerFaction ? 'P1' : 'P2';
  return {
    id: u.instanceId,
    name: u.name,
    type: u.type as EngineUnit['type'],
    owner,
    hp: mkBox(u.hp, u.hpInitial),
    atk: mkBox(u.atk, u.atkInitial),
    mnd: mkBox(u.mnd, u.mndInitial),
    hpCap: u.hpMax,
    row: u.position?.row ?? -1,
    col: u.position?.col ?? -1,
    isAlive: u.hp > 0 && u.zone === 'field',
    form: u.form,
    awakened: !!u.awakened,
    skills: u.registrySkills ?? [],
    perTurn: {
      didBasicAttack: !!u.attackedThisTurn,
      didUltimateAttack: false,
      damageDealtToOthers: 0,
      didCauseAnyDamage: false,
      hasMoved: !!u.hasMovedThisTurn,
      extraActionsGranted: 0,
      extraActionsConsumed: 0,
    },
    portrait: u.portrait,
    ultimateUsed: u.ultimateUsed,
    killCount: u.killCount ?? 0,
  };
}

/** 把 EngineUnit 的变更回写到 S7D BattleCardInstance */
function writeBack(eu: EngineUnit, inst: BattleCardInstance): void {
  inst.hp = eu.hp.current;
  inst.atk = eu.atk.current;
  inst.mnd = eu.mnd.current;
  inst.hpMax = eu.hpCap;
  inst.awakened = eu.awakened;
  inst.form = eu.form;
  inst.ultimateUsed = eu.ultimateUsed;
  inst.killCount = eu.killCount ?? inst.killCount ?? 0;
}

// ============================================================================
// 攻击结果结构
// ============================================================================

export interface AttackOutcome {
  attackerDice: number[];
  defenderDice: number[];
  attackerSum: number;
  defenderSum: number;
  /** 最终伤害 (Math.max(1, 攻-防+加减项)*倍数 的结果, 最低 1 或被 cap) */
  damage: number;
  counterMod: number;
  killed: boolean;
  /** 附带的战报 */
  logs: Array<{ kind: S7DLogKind; text: string }>;
  calcLog: Array<{ source: string; delta: number; note: string }>;
}

// ============================================================================
// Phase 7 主要入口 —— 对接 Store, 完整流程
// ============================================================================

/**
 * 执行一次带完整 hook 流程的攻击. 直接在 state draft 上修改.
 *
 * @returns 攻击结果(含骰子/伤害/是否击杀/战报列表)
 */
export function executeAttackWithHooks(
  state: S7DBattleState,
  attackerId: string,
  defenderId: string,
): AttackOutcome | null {
  const attacker = state.units[attackerId];
  const defender = state.units[defenderId];
  if (!attacker || !defender) return null;
  if (attacker.hp <= 0 || defender.hp <= 0) return null;

  const playerFaction = state.playerFaction;

  // —— 构造可变 snapshot(field 上全部单位, 允许 hook 跨单位修改) ——
  const fieldUnits = Object.values(state.units).filter(
    (u) => u.zone === 'field' && u.hp > 0,
  );
  const snapshots: Record<string, EngineUnit> = {};
  for (const u of fieldUnits) snapshots[u.instanceId] = toEngineUnit(u, playerFaction);

  // 确保攻防双方在 snapshots 里
  if (!snapshots[attackerId]) snapshots[attackerId] = toEngineUnit(attacker, playerFaction);
  if (!snapshots[defenderId]) snapshots[defenderId] = toEngineUnit(defender, playerFaction);

  const logs: Array<{ kind: S7DLogKind; text: string }> = [];
  const addLog = (text: string, kind: S7DLogKind = 'skill_cast') => {
    logs.push({ kind, text });
  };

  let diceAttack = Math.max(1, snapshots[attackerId].atk.current);
  let diceDefend = Math.max(0, snapshots[defenderId].mnd.current);

  const calcLog: Array<{ source: string; delta: number; note: string }> = [];
  const hookFiredSet = new Set<string>();

  // ==========================================================================
  // Engine adapter
  // ==========================================================================
  const engine: Partial<IBattleEngine> = {
    getUnit: (id: string) => snapshots[id],
    getAllUnits: () => Object.values(snapshots),
    getAlliesOf: (self: EngineUnit) =>
      Object.values(snapshots).filter(
        (x) => x.owner === self.owner && x.id !== self.id && x.isAlive,
      ),
    getEnemiesOf: (self: EngineUnit) =>
      Object.values(snapshots).filter((x) => x.owner !== self.owner && x.isAlive),
    emit: (kind, _payload, narrative, opts) => {
      if (opts?.severity === 'debug') return;
      const k: S7DLogKind =
        kind === 'damage_applied'
          ? 'damage'
          : kind === 'unit_leave'
            ? 'death'
            : 'skill_cast';
      addLog(narrative, k);
    },
    changeStat: (id, stat, delta, opts) => {
      const t = snapshots[id];
      if (!t) return 0;
      const box = stat === 'hp' ? t.hp : stat === 'atk' ? t.atk : t.mnd;
      const oldVal = box.current;
      let newVal = oldVal + delta;
      if (opts.floor !== undefined) newVal = Math.max(opts.floor, newVal);
      if (stat === 'hp') {
        if (!opts.breakCap) newVal = Math.min(newVal, t.hpCap);
        newVal = Math.max(0, newVal);
        box.current = newVal;
        box.base = newVal;
        t.isAlive = newVal > 0;
        if (opts.breakCap && newVal > t.hpCap) t.hpCap = newVal;
      } else {
        box.current = newVal;
        box.base = newVal;
      }
      return newVal - oldVal;
    },
    attachModifier: (mod) => {
      addLog(`🪄 挂载修饰器「${mod.sourceSkillId}」到 ${snapshots[mod.targetUnitId]?.name ?? '?'}`);
    },
    queryModifiers: () => [],
    detachModifier: () => {},
    fireHook: () => {},
    fireTurnHook: () => {},
    getRound: () => state.bigRound,
    nextSeq: () => state.logSeq,
    getCurrentActorId: () => attackerId,
    triggerAwakening: (unit, reason) => {
      const t = snapshots[unit.id];
      if (t) {
        t.awakened = true;
        t.form = 'awakened';
        addLog(`🌟 ${t.name} 被动觉醒！（${reason}）`);
      }
    },
  };

  // ==========================================================================
  // AttackContext
  // ==========================================================================
  const ctx: AttackContext = {
    attackKind: 'basic',
    viaUltimate: false,
    segmentIndex: 0,
    attacker: snapshots[attackerId],
    defender: snapshots[defenderId],
    diceAttack,
    diceDefend,
    aSum: 0,
    dSum: 0,
    skillId: undefined,
    hookFiredSet,
    calcLog,
  };

  // ==========================================================================
  // fireHooks 辅助(只对 field 上的单位遍历)
  // ==========================================================================
  function fireHooks(unitId: string, hookName: HookName) {
    const unit = snapshots[unitId];
    if (!unit) return;
    const key = `${unitId}::${hookName}`;
    if (hookFiredSet.has(key)) return;
    hookFiredSet.add(key);
    (ctx as unknown as Record<string, unknown>).__firingUnitId__ = unitId;
    (ctx as unknown as Record<string, unknown>).__firingUnitIsAttacker__ = unitId === attackerId;
    for (const skillId of unit.skills ?? []) {
      const skill = SkillRegistry.get(skillId);
      if (!skill) continue;
      const handler = skill.hooks[hookName];
      if (!handler) continue;
      try {
        (handler as (c: AttackContext, e: IBattleEngine) => void)(ctx, engine as IBattleEngine);
      } catch (e) {
        console.error('[s7d-hook]', hookName, skill.id, e);
      }
    }
    diceAttack = ctx.diceAttack;
    diceDefend = ctx.diceDefend;
  }

  // —— Phase 1 —— 
  fireHooks(attackerId, 'on_before_roll');
  ctx.diceAttack = diceAttack;
  // —— Phase 2 —— 
  fireHooks(defenderId, 'on_before_defend_roll');
  ctx.diceDefend = diceDefend;

  // —— Phase 3: 滚骰 —— 
  const aDice = rollD6(Math.max(1, diceAttack));
  const dDice = rollD6(Math.max(0, diceDefend));
  const aSum = sum(aDice);
  const dSum = sum(dDice);
  ctx.aSum = aSum;
  ctx.dSum = dSum;
  fireHooks(attackerId, 'on_after_attack_roll');

  // —— Phase 4 —— 
  fireHooks(defenderId, 'on_before_being_attacked');
  // —— Phase 5 —— 
  fireHooks(attackerId, 'on_damage_calc');
  fireHooks(defenderId, 'on_damage_calc');

  // —— 计算最终伤害(复刻 S7B 公式: § 5.1) —— 
  let damage = aSum - dSum;
  for (const entry of calcLog) {
    if (entry.source.endsWith('__multiplier__')) continue;
    if (entry.source.endsWith('__cap__')) continue;
    if (entry.source === '__final_damage__') continue;
    damage += entry.delta;
  }
  // 克制
  const counterMod = isCounter(attacker.type, defender.type) ? 1 : 0;
  if (counterMod) damage += counterMod;
  // 翻倍
  for (const entry of calcLog) {
    if (entry.source.endsWith('__multiplier__')) damage = damage * entry.delta;
  }
  // 上限封顶
  for (const entry of calcLog) {
    if (entry.source.endsWith('__cap__')) damage = Math.min(damage, entry.delta);
  }
  // 最低 1
  damage = Math.max(1, damage);
  calcLog.push({ source: '__final_damage__', delta: damage, note: `最终=${damage}` });

  // —— 落实伤害到 snapshot.defender —— 
  const defenderSnap = snapshots[defenderId];
  const newHp = Math.max(0, defenderSnap.hp.current - damage);
  defenderSnap.hp.current = newHp;
  defenderSnap.hp.base = newHp;
  defenderSnap.isAlive = newHp > 0;

  // —— Phase 6 —— 
  ctx.defender = defenderSnap;
  fireHooks(defenderId, 'on_after_being_hit');
  fireHooks(attackerId, 'on_after_hit');

  // —— Phase 7: 击杀相关 hook —— 
  const killed = newHp <= 0;
  if (killed) {
    // killCount +1
    const attackerSnap = snapshots[attackerId];
    attackerSnap.killCount = (attackerSnap.killCount ?? 0) + 1;
    fireHooks(attackerId, 'on_kill');
    fireHooks(defenderId, 'on_self_death');
    fireHooks(defenderId, 'on_self_leave');
    // 全场扫 on_any_death/on_any_ally_death
    for (const id of Object.keys(snapshots)) {
      if (id === defenderId) continue;
      fireHooks(id, 'on_any_death');
      const s = snapshots[id];
      if (s && s.owner === defenderSnap.owner) {
        fireHooks(id, 'on_any_ally_death');
      }
    }
  }

  // ==========================================================================
  // 所有变更写回 S7D state
  // ==========================================================================
  const killedIds: string[] = [];
  for (const [id, eu] of Object.entries(snapshots)) {
    const inst = state.units[id];
    if (!inst) continue;
    writeBack(eu, inst);
    if (inst.hp <= 0 && inst.zone === 'field' && id !== defenderId) {
      // 其他单位因 hook 连锁死亡
      killedIds.push(id);
    }
  }

  // 主防御方先推入
  if (killed) killedIds.unshift(defenderId);

  // 攻击者标记
  attacker.attackedThisTurn = true;

  return {
    attackerDice: aDice,
    defenderDice: dDice,
    attackerSum: aSum,
    defenderSum: dSum,
    damage,
    counterMod,
    killed,
    logs,
    calcLog,
  };
}

// ============================================================================
// 对外包装: 执行攻击 + 写战报 + 清算死亡 + 觉醒扫描
// ============================================================================

/**
 * 在 store 层被调用的完整攻击入口
 *
 * @param state     S7D 战场 state
 * @param attackerId 攻方 instanceId
 * @param defenderId 防方 instanceId
 * @returns 是否成功执行(含伤害/击杀/战报已写)
 */
export function attackAndApply(
  state: S7DBattleState,
  attackerId: string,
  defenderId: string,
): AttackOutcome | null {
  const attacker = state.units[attackerId];
  const defender = state.units[defenderId];
  if (!attacker || !defender) return null;

  const outcome = executeAttackWithHooks(state, attackerId, defenderId);
  if (!outcome) return null;

  // —— 主攻击战报 —— 
  const counterText = outcome.counterMod ? ' [克制+1]' : '';
  const bonusEntries = outcome.calcLog
    .filter((e) => !e.source.endsWith('__multiplier__') && e.source !== '__final_damage__')
    .filter((e) => !e.source.endsWith('__cap__'))
    .filter((e) => e.delta !== 0);
  const bonusText = bonusEntries.length
    ? ` [${bonusEntries.map((e) => e.note).join(' / ')}]`
    : '';
  const multText = outcome.calcLog.some((e) => e.source.endsWith('__multiplier__'))
    ? ` [×${outcome.calcLog
        .filter((e) => e.source.endsWith('__multiplier__'))
        .map((e) => e.delta)
        .join('×')}]`
    : '';
  const capText = outcome.calcLog.some((e) => e.source.endsWith('__cap__'))
    ? ` [封顶 ${Math.min(
        ...outcome.calcLog.filter((e) => e.source.endsWith('__cap__')).map((e) => e.delta),
      )}]`
    : '';

  appendLog(
    state,
    'attack',
    `⚔️ ${attacker.name} 攻击 ${defender.name}：${outcome.attackerSum}(${outcome.attackerDice.join('+')}) vs ${outcome.defenderSum}(${outcome.defenderDice.join('+')})${bonusText}${counterText}${multText}${capText} → ${outcome.damage}伤害`,
    { actorId: attackerId, targetIds: [defenderId] },
  );

  // —— 技能 hook 的战报 —— 
  for (const l of outcome.logs) {
    appendLog(state, l.kind, l.text, { actorId: attackerId });
  }

  // —— 清算死亡 —— 
  // 找出本次攻击中所有 hp<=0 且还在 field 的单位
  const toKill: string[] = [];
  for (const u of Object.values(state.units)) {
    if (u.hp <= 0 && u.zone === 'field') toKill.push(u.instanceId);
  }
  for (const id of toKill) {
    killS7DUnit(state, id, id === defenderId ? '战死' : '连锁击杀');
  }

  // —— 觉醒扫描 —— 
  checkAndTriggerAwakening(state);

  return outcome;
}

// ============================================================================
// 觉醒扫描
// ============================================================================

/**
 * 扫描所有未觉醒主角, 若满足 awakenTrigger, 执行觉醒切换
 * (复刻 s7bBattleStore.ts:1754)
 */
export function checkAndTriggerAwakening(state: S7DBattleState): void {
  const playerFaction = state.playerFaction;

  // 构造只读 adapter
  const snapshots: Record<string, EngineUnit> = {};
  for (const u of Object.values(state.units)) {
    if (u.zone === 'field' || u.zone === 'grave') {
      snapshots[u.instanceId] = toEngineUnit(u, playerFaction);
    }
  }
  const adapter: Partial<IBattleEngine> = {
    getAllUnits: () => Object.values(snapshots),
    getUnit: (id: string) => snapshots[id],
    getAlliesOf: () => [],
    getEnemiesOf: () => [],
    emit: () => {},
    changeStat: () => 0,
    attachModifier: () => {},
    queryModifiers: () => [],
    detachModifier: () => {},
    fireHook: () => {},
    fireTurnHook: () => {},
    getRound: () => state.bigRound,
    nextSeq: () => state.logSeq,
    getCurrentActorId: () => undefined,
    triggerAwakening: () => {},
  };

  const toAwaken: string[] = [];
  for (const u of Object.values(state.units)) {
    if (u.awakened) continue;
    if (!u.heroId || !u.isHero) continue;
    const bp = HERO_BLUEPRINTS[u.heroId];
    if (!bp) continue;
    const trigger = AWAKEN_TRIGGERS[bp.awakenTrigger];
    if (!trigger) continue;
    try {
      const eu = snapshots[u.instanceId];
      if (!eu) continue;
      if (trigger(eu, adapter as IBattleEngine)) {
        toAwaken.push(u.instanceId);
      }
    } catch (e) {
      console.error('[s7d-awaken-trigger]', bp.awakenTrigger, e);
    }
  }

  if (toAwaken.length === 0) return;

  // —— 执行觉醒 —— 
  for (const uid of toAwaken) {
    const u = state.units[uid];
    if (!u || u.awakened || !u.heroId) continue;
    const bp = HERO_BLUEPRINTS[u.heroId];
    if (!bp) continue;
    const b = bp.base;
    const a = bp.awakened;

    // 差值法(同 S7B)
    const atkDelta = a.atk - b.atk;
    const mndDelta = a.mnd - b.mnd;
    const hpCapDelta = a.hpCap - b.hpCap;
    const newMaxHp = u.hpMax + hpCapDelta;
    const wasDead = u.hp <= 0 || u.zone === 'grave';

    u.name = a.name;
    u.type = a.type as BattleCardInstance['type'];
    u.hpMax = newMaxHp;
    u.hp = newMaxHp; // 觉醒重置满血
    u.atk = u.atk + atkDelta;
    u.mnd = u.mnd + mndDelta;
    u.portrait = a.portrait ?? u.portrait;
    u.registrySkills = [...a.skills];
    u.awakened = true;
    u.form = 'awakened';
    u.ultimateUsed = false; // 觉醒绝技重置

    // 若 awaken 时已阵亡(如小舞献祭), 拉回战场
    // 暂按"保留在 grave"处理, 以便后续规则明朗后再调整
    appendLog(
      state,
      'skill_cast',
      wasDead
        ? `🌟✨ ${u.name} 觉醒！（死后觉醒：${bp.awakenTrigger}）`
        : `🌟 ${u.name} 觉醒！境界飞升为【${a.name}】`,
      { actorId: uid, payload: { awakenTrigger: bp.awakenTrigger } },
    );
  }
}

// ============================================================================
// 工具
// ============================================================================

function rollD6(n: number): number[] {
  const a: number[] = [];
  for (let i = 0; i < Math.max(0, Math.floor(n)); i++) {
    a.push(1 + Math.floor(Math.random() * 6));
  }
  return a;
}

function sum(a: number[]): number {
  return a.reduce((x, y) => x + y, 0);
}
