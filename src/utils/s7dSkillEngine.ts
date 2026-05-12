/**
 * S7D · 技能引擎适配器（Batch 2B）
 *
 * 职责：把 S7D 的 BattleCardInstance 与 SkillRegistry 的 BattleUnit 双向适配，
 *      构造 IBattleEngine 的 adapter，让主角/战卡的战技/绝技效果真实生效。
 *
 * 设计参照 S7B 的 performUltimate 模式（src/stores/s7bBattleStore.ts:1050+），
 * 抽出一套纯函数，供 s7dBattleStore 调用。
 *
 * 能力：
 *   - mapInstanceToEngineUnit：S7D 卡 → 引擎 Unit（只读快照）
 *   - applyEngineChangesBack：引擎 Unit 的变更 → 写回 S7D state
 *   - executeSkillViaEngine：构造 adapter、调 activeCast、回写变更、输出战报
 *
 * 约束：
 *   - 本模块不导入 store（避免循环依赖），只在 store 层被调用
 *   - 所有状态变更都作用在传入的 state 上（immer producer 已处理）
 */

import type {
  BattleUnit as EngineUnit,
  StatBox,
  IBattleEngine,
  PrecheckResult,
} from '@/systems/battle/types';
import { SkillRegistry } from '@/systems/battle/skillRegistry';
import type {
  BattleCardInstance,
  S7DBattleState,
  S7DLogKind,
} from '@/types/s7dBattle';
import { appendLog, killUnit as killS7DUnit } from './s7dBattleActions';
import { attackAndApply } from './s7dAttackEngine';
import { isWalkable as isS7DCellWalkable, S7D_MAP_ROWS, S7D_MAP_COLS } from '@/data/s7dMap';
// 🔧 2026-05-12：让主动技能 activeCast 挂出的 modifier 真正落到全局 store
// （修复古元绝技、远古斗帝血脉、凝荣荣群体 buff 等完全哑火的 bug）
import { globalModStore } from '@/systems/battle/e2Helpers';

// =============================================================================
// 映射层：S7D BattleCardInstance ↔ 引擎 EngineUnit
// =============================================================================

/**
 * 把 S7D 的 BattleCardInstance 映射为引擎 BattleUnit（StatBox 结构）。
 * 用于 hook handler / activeCast 的只读访问。
 * 写操作必须走 adapter.changeStat，由 applyEngineChangesBack 回写。
 */
export function mapInstanceToEngineUnit(
  u: BattleCardInstance,
  playerFaction: 'A' | 'B',
): EngineUnit {
  const mkBox = (n: number, initial: number): StatBox => ({
    base: n,
    current: n,
    initial,
  });
  // S7D 是 6 方对战，但引擎只认 P1/P2 二元阵营
  // 以玩家阵营为"P1"，对方阵营为"P2"（足够支撑绝大多数 active 技能逻辑）
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

// =============================================================================
// 快照 → 回写：把引擎变更写回 S7D state
// =============================================================================

/**
 * 把引擎 EngineUnit 的当前值回写到 S7D BattleCardInstance。
 * 只同步 hp/atk/mnd/awakened/form 这些会被 activeCast 改动的字段。
 */
function writeEngineBackToInstance(eu: EngineUnit, inst: BattleCardInstance): void {
  inst.hp = eu.hp.current;
  inst.atk = eu.atk.current;
  inst.mnd = eu.mnd.current;
  inst.hpMax = eu.hpCap;
  inst.awakened = eu.awakened;
  inst.form = eu.form;
  inst.ultimateUsed = eu.ultimateUsed;
  // 若 hp<=0 则由外层统一推入弃牌区（killS7DUnit）
}

// =============================================================================
// 技能执行入口
// =============================================================================

export interface SkillExecuteResult {
  ok: boolean;
  reason?: string;
  /** 引擎产出的战报条目（待 store 追加到 logs） */
  logs: Array<{ kind: S7DLogKind; narrative: string }>;
  /** 死亡的单位 id（store 后续调用 killUnit 推入弃牌区） */
  killedIds: string[];
}

/**
 * 通过引擎 adapter 执行一次 active 技能。
 *
 * @param state     当前 S7D 战场 state（immer draft）
 * @param casterId  施法者 instanceId
 * @param skillType 'battle' | 'ultimate'
 * @param targetIds 目标 instanceIds（可空，AOE 会由 precheck 补充）
 */
export function executeSkillViaEngine(
  state: S7DBattleState,
  casterId: string,
  skillType: 'battle' | 'ultimate',
  targetIds: string[],
): SkillExecuteResult {
  const caster = state.units[casterId];
  if (!caster) return { ok: false, reason: '施法者不存在', logs: [], killedIds: [] };
  if (caster.zone !== 'field' || caster.hp <= 0) {
    return { ok: false, reason: '施法者不在场或已阵亡', logs: [], killedIds: [] };
  }

  const meta = skillType === 'ultimate' ? caster.ultimate : caster.battleSkill;
  if (!meta) return { ok: false, reason: '该单位无此技能', logs: [], killedIds: [] };

  // 查询 SkillRegistry
  const regId = SkillRegistry.findIdByName(meta.name);
  if (!regId) {
    return {
      ok: false,
      reason: `技能【${meta.name}】尚未实装`,
      logs: [
        {
          kind: 'skill_cast',
          narrative: `⚠️ 技能【${meta.name}】尚未接入引擎（regId 未找到），仅做占位`,
        },
      ],
      killedIds: [],
    };
  }
  const skill = SkillRegistry.get(regId);
  if (!skill) return { ok: false, reason: '技能注册失效', logs: [], killedIds: [] };

  // battle_skill（被动类）没有 activeCast —— 大多数战技是 hook 被动，不能手动发动
  if (skillType === 'battle' && (!skill.isActive || !skill.activeCast)) {
    return {
      ok: false,
      reason: '该战技为被动技，在满足触发条件时自动生效（无需手动释放）',
      logs: [],
      killedIds: [],
    };
  }
  if (!skill.activeCast) {
    return { ok: false, reason: '该技能不可主动释放', logs: [], killedIds: [] };
  }

  // ---------------------------------------------------------------------------
  // 构造 snapshots：所有 field 上的单位 → 临时可变 EngineUnit 集合
  // ---------------------------------------------------------------------------
  const playerFaction = state.playerFaction;
  const fieldUnits = Object.values(state.units).filter(
    (u) => u.zone === 'field' && u.hp > 0,
  );
  const snapshots: Record<string, EngineUnit> = {};
  for (const u of fieldUnits) {
    snapshots[u.instanceId] = mapInstanceToEngineUnit(u, playerFaction);
  }

  const engineLogs: Array<{ kind: S7DLogKind; narrative: string }> = [];
  const addLog = (
    kind: S7DLogKind,
    narrative: string,
  ) => engineLogs.push({ kind, narrative });

  // ---------------------------------------------------------------------------
  // 构造 adapter（IBattleEngine 的部分实现）
  // ---------------------------------------------------------------------------
  const adapter: Partial<IBattleEngine> = {
    getUnit: (id: string) => snapshots[id],
    getAllUnits: () => Object.values(snapshots),
    getAlliesOf: (self: EngineUnit) => {
      return Object.values(snapshots).filter(
        (x) => x.owner === self.owner && x.id !== self.id && x.isAlive,
      );
    },
    getEnemiesOf: (self: EngineUnit) => {
      return Object.values(snapshots).filter(
        (x) => x.owner !== self.owner && x.isAlive,
      );
    },
    emit: (kind, _payload, narrative, opts) => {
      if (opts?.severity === 'debug') return;
      // 把引擎 kind 映射到 S7D 的 S7DLogKind
      const k: S7DLogKind =
        kind === 'damage_applied'
          ? 'attack'
          : kind === 'unit_leave'
            ? 'death'
            : 'skill_cast';
      addLog(k, narrative);
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
      // 🔧 2026-05-12：真正挂到全局 modifier store，让 stat_delta（古元绝技、
      //    凝荣荣群体 buff）和 stat_set / disable_move 等下游消费者读得到。
      globalModStore.attach(mod);
      addLog(
        'skill_cast',
        `「${mod.sourceSkillId}」挂载修饰器到 ${snapshots[mod.targetUnitId]?.name ?? '?'}`,
      );
    },
    queryModifiers: (uid, kind) => globalModStore.query(uid, kind) as any,
    detachModifier: (mid) => {
      globalModStore.detach(mid);
    },
    fireHook: () => {},
    fireTurnHook: () => {},
    getRound: () => state.bigRound,
    nextSeq: () => state.log.length,
    getCurrentActorId: () => casterId,
    triggerAwakening: (unit, reason) => {
      const t = snapshots[unit.id];
      if (t) {
        t.awakened = true;
        t.form = 'awakened';
        addLog('skill_cast', `🌟 ${t.name} 觉醒！（${reason}）`);
      }
    },
  };

  // ---------------------------------------------------------------------------
  // precheck + 候选补齐
  // ---------------------------------------------------------------------------
  const casterEngineUnit = mapInstanceToEngineUnit(caster, playerFaction);
  let precheckCandidates: string[] = [];
  if (skill.precheck) {
    const pre: PrecheckResult = skill.precheck(casterEngineUnit, adapter as IBattleEngine);
    if (!pre.ok) {
      return {
        ok: false,
        reason: pre.reason ?? '技能无法发动',
        logs: [],
        killedIds: [],
      };
    }
    precheckCandidates = pre.candidateIds ?? [];
  }

  // AOE 类 selector：若 UI 未传 targetIds，则用 precheck.candidateIds
  const AOE_SELECTORS = new Set([
    'cross_adjacent_enemies',
    'all_adjacent_enemies',
    'all_enemies',
    'all_allies_incl_self',
  ]);
  let effectiveTargetIds = targetIds;
  if (
    (!effectiveTargetIds || effectiveTargetIds.length === 0) &&
    skill.targetSelector &&
    AOE_SELECTORS.has(skill.targetSelector.kind) &&
    precheckCandidates.length > 0
  ) {
    effectiveTargetIds = precheckCandidates;
  }

  // ---------------------------------------------------------------------------
  // 执行 activeCast
  // ---------------------------------------------------------------------------
  let castResult: { consumed: boolean };
  try {
    castResult = skill.activeCast(
      casterEngineUnit,
      effectiveTargetIds,
      adapter as IBattleEngine,
    );
  } catch (err) {
    console.error('[executeSkillViaEngine] activeCast 抛出异常:', err);
    return {
      ok: false,
      reason: `技能执行异常：${(err as Error).message}`,
      logs: engineLogs,
      killedIds: [],
    };
  }

  if (!castResult.consumed) {
    // 技能主动撤销（前置失败），不消耗次数
    return {
      ok: false,
      reason: '技能已取消（前置条件未满足）',
      logs: engineLogs,
      killedIds: [],
    };
  }

  // ---------------------------------------------------------------------------
  // 回写 snapshots → state.units
  // ---------------------------------------------------------------------------
  const killedIds: string[] = [];
  for (const [id, eu] of Object.entries(snapshots)) {
    const inst = state.units[id];
    if (!inst) continue;
    // snapshot.id 写回 caster 自身的 ultimateUsed（已由引擎在 activeCast 里标记）
    writeEngineBackToInstance(eu, inst);
    if (inst.hp <= 0 && inst.zone === 'field') {
      killedIds.push(id);
    }
  }

  // 强制消耗绝技次数（兜底：某些技能 code 没写 self.ultimateUsed = true）
  if (skillType === 'ultimate') {
    caster.ultimateUsed = true;
  }
  caster.skillUsedThisTurn = true;

  return { ok: true, logs: engineLogs, killedIds };
}

// =============================================================================
// 统一入口（含战报发射 + 死亡推入弃牌区）
// =============================================================================

/**
 * 多段 AOE 技能路由表（对每个目标独立结算一次攻击）
 *   - key = SkillRegistry id
 *   - diceOverride: 攻击前临时修改 atk（模拟加骰）
 *   - postHit: 每段命中后对目标的额外处理（如吞噬-1 atk）
 *
 * 这些技能的 activeCast 仅做"标记+emit"，实际伤害段由本路由展开 basicAttack。
 * 参考 S7B s7bBattleStore.ts:1195 实现。
 */
const MULTI_SEGMENT_SKILLS: Record<
  string,
  {
    diceOverride?: (caster: BattleCardInstance) => number;
    postHit?: (target: BattleCardInstance, log: (msg: string) => void) => void;
  }
> = {
  'hero_xiaoyan.ultimate': {
    // 佛怒火莲：对每个相邻敌人 1 次普攻
  },
  'hero_tangsan.ultimate': {
    // 万毒淬体：每段附带目标 atk 永久 -1
    postHit: (target, log) => {
      if (target.atk > 1) {
        target.atk = Math.max(1, target.atk - 1);
        log(`☠️ ${target.name} 修为被万毒淬体永久-1`);
      } else {
        log(`${target.name} 修为已为1，吞噬未生效`);
      }
    },
  },
  'hero_tangsan.awaken.ultimate': {
    // 修罗弑神击：本次攻击骰数 = atk × 2
    diceOverride: (caster) => caster.atk * 2,
  },
  'hero_hanli.ultimate': {
    // 万剑归宗：本次攻击骰数 = atk × 2
    diceOverride: (caster) => caster.atk * 2,
  },
  'sr_mahongjun.ultimate': {
    // 凤凰火雨：对每个相邻敌人 1 次普攻
  },
  'bssr_tanghao.ult': {
    // 破天：单目标攻击，骰数 = atk + 5
    diceOverride: (caster) => caster.atk + 5,
  },
};

/**
 * 执行技能 + 同步写战报 + 处理死亡。
 * 这是 store 层应该调用的高层函数。
 *
 * @returns 是否成功施放
 */
export function castSkillAndApply(
  state: S7DBattleState,
  casterId: string,
  skillType: 'battle' | 'ultimate',
  targetIds: string[],
  pickedPosition?: { row: number; col: number },
): boolean {
  const caster = state.units[casterId];
  if (!caster) return false;
  const meta = skillType === 'ultimate' ? caster.ultimate : caster.battleSkill;
  if (!meta) return false;

  // 查 regId（供多段路由使用）
  const regId = SkillRegistry.findIdByName(meta.name);

  const res = executeSkillViaEngine(state, casterId, skillType, targetIds);

  if (!res.ok) {
    if (res.reason) {
      appendLog(state, 'skill_cast', `⚠️ ${res.reason}`, { actorId: casterId });
    }
    for (const l of res.logs) {
      appendLog(state, l.kind, l.narrative, { actorId: casterId });
    }
    return false;
  }

  // 首条战报：技能发动
  const prefix = skillType === 'ultimate' ? '⚡' : '✨';
  const label = skillType === 'ultimate' ? '释放绝技' : '使用战技';
  appendLog(state, 'skill_cast', `${prefix} ${caster.name} ${label}【${meta.name}】！`, {
    actorId: casterId,
    targetIds,
    payload: { skillType, skillName: meta.name },
  });

  // 引擎 emit 的战报
  for (const l of res.logs) {
    appendLog(state, l.kind, l.narrative, { actorId: casterId });
  }

  // 处理死亡
  for (const deadId of res.killedIds) {
    killS7DUnit(state, deadId, `被【${meta.name}】击败`);
  }

  // ==========================================================================
  // 续命丹专用路由（2026-05-11 D1 实装）
  // 沐佩玲·灵药·续命丹：activeCast 仅 emit 战报，store 层负责真实复活
  // 找一名已退场（zone='grave'）的非主角友军，hp=3 重新入场
  // ==========================================================================
  if (regId === 'sr_mupeiling.ultimate' && skillType === 'ultimate') {
    revivableViaXumingDan(state, caster);
  }

  // ==========================================================================
  // 🦋 鸿蝶蛊惑专用路由（2026-05-12 实装至 S7D）
  //   activeCast 仅 emit 战报，store 层负责给目标打 charmedNextTurn 标记
  //   下一回合该单位行动开始时，dispatchS7DTurnHook(start) 会消费并强制其攻击友军
  // ==========================================================================
  if (regId === 'sr_hongdie.ultimate' && skillType === 'ultimate') {
    for (const ti of targetIds) {
      const t = state.units[ti];
      if (t && t.zone === 'field' && t.hp > 0) {
        t.charmedNextTurn = true;
        appendLog(
          state,
          'skill_cast',
          `🦋 红蝶蛊惑：${t.name} 下一行动轮将倒戈攻击其相邻友军`,
          { actorId: casterId, targetIds: [ti] },
        );
      }
    }
  }

  // ==========================================================================
  // 萧战祖树盾专用路由（2026-05-11 实装至 S7D）
  // 在 pickedPosition 落点放置永久障碍（任何人不可通过）
  // ==========================================================================
  if (regId === 'bsr_xiaozhan.ult' && skillType === 'ultimate' && pickedPosition) {
    const { row: pr, col: pc } = pickedPosition;
    // 合法性校验
    const inBoard =
      pr >= 0 && pr < S7D_MAP_ROWS && pc >= 0 && pc < S7D_MAP_COLS;
    const cellWalkable = inBoard && isS7DCellWalkable(pr, pc);
    const occupied = Object.values(state.units).some(
      (x) => x.zone === 'field' && x.hp > 0 && x.position?.row === pr && x.position?.col === pc,
    );
    const dynKey = `${pr},${pc}`;
    const alreadyObs = (state.dynamicObstacles ?? []).includes(dynKey);
    if (inBoard && cellWalkable && !occupied && !alreadyObs) {
      const list = state.dynamicObstacles ?? [];
      state.dynamicObstacles = [...list, dynKey];
      appendLog(state, 'skill_cast', `🌳 萧族护盾：在 (${pr},${pc}) 布置了永久阻碍物`, {
        actorId: casterId,
        payload: { row: pr, col: pc },
      });
    } else {
      appendLog(state, 'skill_cast', `🌳 萧族护盾落点不合法（越界/河道/被占据/已布置），技能无效化`, {
        actorId: casterId,
      });
    }
  }

  // ==========================================================================
  // 多段 AOE 展开（Batch 2C → 2026-05-11 架构升级）
  //   现在根据 skill.followUpAttack 字段动态判断，不再读硬编码白名单 MULTI_SEGMENT_SKILLS
  //   兼容：如果新技能在 SkillRegistry 注册了 followUpAttack，自动生效
  //   兜底：旧白名单仍保留（向后兼容，未声明 followUpAttack 的旧技能仍走原路径）
  // ==========================================================================
  let followUpInfo: {
    diceOverride?: (caster: BattleCardInstance) => number;
    postHit?: (target: BattleCardInstance, log: (msg: string) => void) => void;
    perTarget: boolean;
  } | null = null;

  if (regId && skillType === 'ultimate') {
    const skillReg = SkillRegistry.get(regId);
    if (skillReg?.followUpAttack) {
      const fua = skillReg.followUpAttack;
      followUpInfo = {
        perTarget: fua.perTarget === true,
        diceOverride: fua.diceOverride
          ? (caster) => fua.diceOverride!({ atk: { current: caster.atk } } as any)
          : undefined,
        postHit: fua.postHit
          ? (target, log) => fua.postHit!(target as any, log)
          : undefined,
      };
    } else if (MULTI_SEGMENT_SKILLS[regId]) {
      // 旧白名单兜底（保留已经手动注册的 6 个绝技兼容性）
      const old = MULTI_SEGMENT_SKILLS[regId];
      followUpInfo = {
        perTarget: true, // 旧白名单一律按多段处理
        diceOverride: old.diceOverride,
        postHit: old.postHit,
      };
    }
  }

  if (followUpInfo) {
    const fu = followUpInfo;
    // 确定目标列表：如果外部传入 targetIds 为空，从相邻敌人补全
    const baseTargets =
      targetIds.length > 0
        ? targetIds
        : findAdjacentEnemies(state, casterId);
    const effTargets = fu.perTarget ? baseTargets : baseTargets.slice(0, 1);

    for (const tid of effTargets) {
      const attackerCur = state.units[casterId];
      const target = state.units[tid];
      if (!attackerCur || !target) continue;
      if (attackerCur.hp <= 0 || target.hp <= 0) continue;
      if (target.zone !== 'field') continue;

      // 临时改骰数
      let restoreAtk: number | null = null;
      if (fu.diceOverride) {
        restoreAtk = attackerCur.atk;
        attackerCur.atk = fu.diceOverride(attackerCur);
      }

      // 发动攻击
      attackAndApply(state, casterId, tid);

      // 恢复 atk
      if (restoreAtk !== null) {
        attackerCur.atk = restoreAtk;
      }

      // 段后处理（万毒淬体等）
      if (fu.postHit) {
        const stillAlive = state.units[tid];
        if (stillAlive && stillAlive.hp > 0) {
          fu.postHit(stillAlive, (msg) =>
            appendLog(state, 'skill_cast', msg, { actorId: casterId, targetIds: [tid] }),
          );
        }
      }
    }
  }

  return true;
}

// ============================================================================
// 辅助：查找相邻敌人
// ============================================================================

function findAdjacentEnemies(state: S7DBattleState, casterId: string): string[] {
  const caster = state.units[casterId];
  if (!caster || !caster.position) return [];
  const { row, col } = caster.position;
  const result: string[] = [];
  for (const u of Object.values(state.units)) {
    if (u.instanceId === casterId) continue;
    if (u.faction === caster.faction) continue;
    if (u.zone !== 'field' || u.hp <= 0 || !u.position) continue;
    const dist = Math.abs(u.position.row - row) + Math.abs(u.position.col - col);
    if (dist === 1) result.push(u.instanceId);
  }
  return result;
}

// ============================================================================
// 续命丹真实复活（2026-05-11 D1 · 沐佩玲专用）
// 选第一名已退场的同阵营非主角卡，hp=3 重新入场
// ============================================================================
function revivableViaXumingDan(
  state: S7DBattleState,
  caster: BattleCardInstance,
): void {
  // 候选：同阵营 + zone='grave' + 非主角
  const dead = Object.values(state.units).find(
    (u) =>
      u.faction === caster.faction &&
      u.zone === 'grave' &&
      !u.isHero &&
      u.instanceId !== caster.instanceId,
  );
  if (!dead) {
    appendLog(
      state,
      'skill_cast',
      `💊 灵药·续命丹未生效——无可复活的友军（已退场的非主角卡）`,
      { actorId: caster.instanceId },
    );
    return;
  }

  // 选槽位：优先 slot1，再 slot2
  const owner = state.players.find((p) => p.ownerId === dead.ownerId);
  if (!owner) return;

  let targetSlot: 1 | 2 | null = null;
  if (!owner.fieldSlots.slot1) targetSlot = 1;
  else if (!owner.fieldSlots.slot2) targetSlot = 2;

  if (!targetSlot) {
    appendLog(
      state,
      'skill_cast',
      `💊 灵药·续命丹未生效——${dead.name} 的归属玩家战斗区已满`,
      { actorId: caster.instanceId, targetIds: [dead.instanceId] },
    );
    return;
  }

  // 找一个空 position（caster 附近 → 否则任意空格）
  let landingPos: { row: number; col: number } | null = null;
  if (caster.position) {
    const dirs = [
      [0, 1], [0, -1], [1, 0], [-1, 0],
      [1, 1], [1, -1], [-1, 1], [-1, -1],
    ];
    for (const [dr, dc] of dirs) {
      const r = caster.position.row + dr;
      const c = caster.position.col + dc;
      const occupied = Object.values(state.units).some(
        (u) => u.zone === 'field' && u.position?.row === r && u.position?.col === c,
      );
      if (!occupied && r >= 0 && c >= 0) {
        landingPos = { row: r, col: c };
        break;
      }
    }
  }
  if (!landingPos) {
    // 全图扫描找空格
    outer: for (let r = 0; r < 10; r += 1) {
      for (let c = 0; c < 10; c += 1) {
        const occupied = Object.values(state.units).some(
          (u) => u.zone === 'field' && u.position?.row === r && u.position?.col === c,
        );
        if (!occupied) {
          landingPos = { row: r, col: c };
          break outer;
        }
      }
    }
  }
  if (!landingPos) {
    appendLog(
      state,
      'skill_cast',
      `💊 灵药·续命丹未生效——棋盘已无空位`,
      { actorId: caster.instanceId, targetIds: [dead.instanceId] },
    );
    return;
  }

  // 真实复活
  dead.hp = 3;
  dead.hpMax = Math.max(dead.hpMax, 3);
  dead.zone = 'field';
  dead.position = landingPos;
  dead.fieldSlot = targetSlot;
  dead.deadAtBigRound = undefined;
  dead.deadAtSubRound = undefined;
  dead.hasActedThisTurn = true; // 本轮不能立刻行动
  dead.attackedThisTurn = false;
  if (targetSlot === 1) owner.fieldSlots.slot1 = dead.instanceId;
  else owner.fieldSlots.slot2 = dead.instanceId;

  appendLog(
    state,
    'skill_cast',
    `💊 灵药·续命丹：${dead.name} 以 3 点气血重新入场 (${landingPos.row},${landingPos.col})`,
    {
      actorId: caster.instanceId,
      targetIds: [dead.instanceId],
      payload: { skillId: 'sr_mupeiling.ultimate', revive: true },
    },
  );
}
