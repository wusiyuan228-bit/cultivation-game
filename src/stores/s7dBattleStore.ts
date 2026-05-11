/**
 * S7D · 坠魔谷决战战场 Store（Zustand）
 *
 * 职责：
 *   - 持有战场运行时状态（S7DBattleState）
 *   - 暴露初始化 / 行动 / 查询 / 重置接口
 *   - 本 Store **不持久化**：每场决战开始时用 initBattle 重建，战斗结束或离开即清空
 *
 * 设计风格：
 *   - 参考项目现有 s7bBattleStore / battleStore，使用原生 zustand（不依赖 immer）
 *   - 通过浅 clone state 方式触发订阅者刷新
 *   - 所有 mutation 委托给 src/utils/s7dBattleActions.ts 中的纯函数
 *
 * 与其他模块的关系：
 *   - 类型定义 → src/types/s7dBattle.ts
 *   - 初始化  → src/utils/s7dBattleInit.ts
 *   - 查询    → src/utils/s7dBattleQueries.ts
 *   - 操作    → src/utils/s7dBattleActions.ts
 *   - 回合/技能引擎 → src/systems/battle/ （后续 S7D_Battle 页面接入）
 */

import { create } from 'zustand';
import type {
  BattleCardInstance,
  BattleFaction,
  BattleOwnerId,
  FieldSlot,
  GridPos,
  ReinforceTask,
  S7DBattleInitParams,
  S7DBattleState,
} from '@/types/s7dBattle';
import { initS7DBattle } from '@/utils/s7dBattleInit';
import {
  appendLog,
  advanceActor,
  advanceSubRound,
  damageUnit,
  deployFromHand,
  healUnit,
  killUnit,
  moveUnit,
  setWinner,
  getAvailableSpawnPositions,
} from '@/utils/s7dBattleActions';
import { castSkillAndApply } from '@/utils/s7dSkillEngine';
import { mapInstanceToEngineUnit } from '@/utils/s7dSkillEngine';
import {
  dispatchTurnStartHooks,
  dispatchTurnEndHooks,
  applyTurnStartChoice,
  type TurnStartDispatchCtx,
} from '@/systems/battle/turnStartDispatcher';
import {
  attackAndApply,
  checkAndTriggerAwakening,
  computeFengShuCandidatesS7D,
  type AttackOutcome,
} from '@/utils/s7dAttackEngine';
import {
  checkWinCondition,
  getCurrentAction,
  getCurrentActor,
  getFactionFieldUnits,
  getFieldUnits,
  getGraveUnits,
  getHandUnits,
  getPlayer,
  getReachableCells,
  getUnit,
  getUnitAt,
} from '@/utils/s7dBattleQueries';

// ==========================================================================
// Store 接口
// ==========================================================================

interface S7DBattleStore {
  /** 战场状态（null = 未初始化） */
  state: S7DBattleState | null;

  // ------ 生命周期 ------
  /** 使用玩家 + 5 AI 阵容初始化战场（async：需加载卡池数据） */
  initBattle: (params: S7DBattleInitParams) => Promise<void>;
  /** 清空战场（离开页面 / 战斗结束时调用） */
  clearBattle: () => void;

  // ------ 查询（不改 state，方便组件用） ------
  getUnit: (instanceId: string) => BattleCardInstance | undefined;
  getPlayer: (ownerId: BattleOwnerId) => ReturnType<typeof getPlayer>;
  getUnitAt: (row: number, col: number) => BattleCardInstance | null;
  getFieldUnits: (ownerId: BattleOwnerId) => BattleCardInstance[];
  getHandUnits: (ownerId: BattleOwnerId) => BattleCardInstance[];
  getGraveUnits: (ownerId: BattleOwnerId) => BattleCardInstance[];
  getFactionFieldUnits: (faction: BattleFaction) => BattleCardInstance[];
  getReachableCells: (instanceId: string) => GridPos[];
  getCurrentAction: () => ReturnType<typeof getCurrentAction> | undefined;
  getCurrentActor: () => BattleCardInstance | undefined;
  getAvailableSpawns: (ownerId: BattleOwnerId) => GridPos[];
  getReinforceTask: (ownerId: BattleOwnerId) => ReinforceTask | undefined;

  // ------ 操作（mutator） ------
  /** 移动单位到指定位置（由上层校验可达性） */
  moveUnit: (instanceId: string, to: GridPos, steps: number) => boolean;
  /**
   * 单步移动（用于逐格动画）：仅推进一格 + 累加 1 步，**不写战报**。
   * 与 S7B `moveUnitStep` 对齐 —— 战报由 UI 层在动画结束后补写一条总结。
   */
  moveUnitStep: (instanceId: string, to: GridPos) => boolean;
  /** 对单位造成伤害 */
  damageUnit: (instanceId: string, amount: number, reason: string, attackerId?: string) => number;
  /** 治疗单位 */
  healUnit: (instanceId: string, amount: number, reason: string) => number;
  /** 直接击杀（一般由 damageUnit 间接触发，此处暴露用于技能直接处决） */
  killUnit: (instanceId: string, reason: string, killerId?: string) => void;
  /** 从手牌补位到战斗区 */
  deployFromHand: (
    ownerId: BattleOwnerId,
    instanceId: string,
    slot: FieldSlot,
    to: GridPos,
  ) => { ok: boolean; reason?: string };
  /** 推进当前行动者 */
  advanceActor: () => 'next_actor' | 'sub_round_end' | 'blocked';
  /** 进入下一小轮次（或下一大回合） */
  advanceSubRound: () => 'started' | 'ended' | 'blocked';
  /** 强制检查胜负并写入（通常由 advanceSubRound 内部调用，此处暴露供紧急调用） */
  checkWin: () => void;
  /** 追加一条自定义战报 */
  log: (text: string) => void;
  /** 使用战技（Batch 2B：接入 SkillRegistry 真实执行） */
  useBattleSkill: (casterId: string, targetIds: string[]) => boolean;
  /** 使用绝技（Batch 2B：接入 SkillRegistry 真实执行） */
  useUltimate: (casterId: string, targetIds: string[]) => boolean;
  /** 执行一次完整带 hook 的攻击（Batch 2C） */
  performAttack: (
    attackerId: string,
    defenderId: string,
    fengshuOverride?: { row: number; col: number } | null,
  ) => AttackOutcome | null;
  /** 风属斗技 · 计算候选落点（玩家选位 UI 用） */
  computeFengShuCandidates: (
    attackerId: string,
    defenderId: string,
  ) => Array<{ row: number; col: number }>;
  /** 手动触发觉醒扫描（Batch 2C） */
  scanAwakenings: () => void;

  // ─────────────────────────────────────────────────────────────
  // 玩家可控的 turn-start 选择（2026-05-11 玩家选择弹窗）
  // ─────────────────────────────────────────────────────────────
  /**
   * 当前 actor 携带 interactiveOnTurnStart 元数据 + 玩家控制 + 有可选项时填入。
   * UI 监听非空状态并弹窗。
   */
  pendingTurnStartChoice: {
    actorId: string;
    skillId: string;
    promptTitle: string;
    promptBody: string;
    choices: Array<{ targetId: string; stats?: Array<'atk' | 'mnd' | 'hp'> }>;
  } | null;
  /** 玩家点确认 → 跑 apply 并清空 */
  confirmTurnStartChoice: (
    targetId: string,
    stat: 'atk' | 'mnd' | 'hp' | undefined,
  ) => void;
  /** 玩家点否 → 仅清空，不结算 */
  cancelTurnStartChoice: () => void;

  // ─────────────────────────────────────────────────────────────
  // 玩家可控的复活分配弹窗（2026-05-11 ReviveAllocateModal）
  // ─────────────────────────────────────────────────────────────
  /** 玩家方角色因徐立国"天罡元婴·重塑"复活时弹出，让玩家分配 8 点 atk/mnd/hp */
  pendingRevive: {
    unitId: string;
    unitName: string;
    current: { atk: number; mnd: number; hp: number };
  } | null;
  /** 玩家点确认 → 用新分配重写角色属性 */
  confirmReviveAllocate: (payload: { atk: number; mnd: number; hp: number }) => void;
  /** 玩家放弃调整 → 保持默认 */
  cancelReviveAllocate: () => void;

  /** DEBUG：强制结束战斗（仅测试用） */
  debugForceEnd: (winner: 'A' | 'B' | 'draw', reason?: 'crystal_broken' | 'all_dead' | 'timeout') => void;
}

// ==========================================================================
// Store 实现
// ==========================================================================

/**
 * 触发订阅者刷新的工具函数。
 * Zustand 原生模式下，需要 set({ state: { ...state } }) 返回新引用。
 */
function bump(state: S7DBattleState): S7DBattleState {
  return {
    ...state,
    units: { ...state.units },
    players: state.players.map((p) => ({
      ...p,
      fieldSlots: { ...p.fieldSlots },
      instanceIds: p.instanceIds.slice(),
    })),
    crystalA: { ...state.crystalA, damageLog: state.crystalA.damageLog.slice() },
    crystalB: { ...state.crystalB, damageLog: state.crystalB.damageLog.slice() },
    actionQueue: state.actionQueue.slice(),
    reinforceQueue: state.reinforceQueue.slice(),
    log: state.log.slice(),
  };
}

/**
 * 安全地执行 mutator：
 *   - 读取当前 state
 *   - 执行 mutator（直接修改 state 对象）
 *   - bump 并 set
 *   - 返回 mutator 的返回值
 */
function mutate<T>(
  get: () => S7DBattleStore,
  set: (partial: Partial<S7DBattleStore>) => void,
  mutator: (state: S7DBattleState) => T,
): T | undefined {
  const current = get().state;
  if (!current) {
    console.warn('[s7dBattleStore] state 尚未初始化');
    return undefined;
  }
  const result = mutator(current);
  set({ state: bump(current) });
  return result;
}

// ==========================================================================
// 🔧 2026-05-11 修复：S7D turn-start / turn-end hook 派发器
// ==========================================================================

/**
 * 派发某个 actor 的 turn-start / turn-end hook。
 *
 * 背景：之前 S7D 战斗系统的 fireTurnHook 为空函数，导致 8+ 个 turn-hook 技能
 * （云鹊子·窃元、谷鹤·聚元炉、萧炎觉醒·焚天、雅妃·补给、黎沐婉·清思、
 * 古元·古族天火阵 aura、凝荣荣·七宝加持 aura 等）在决战中从未生效。
 *
 * 实现：
 *   - 只读路径走 mapInstanceToEngineUnit + 全局 globalModStore
 *   - 写路径仅支持 hp / atk / mnd 三类，直接 mutate state.units[id]
 *   - 通过 store 的 bump() 触发订阅刷新
 */
const _s7dTurnHookFired = new Set<string>(); // key: `${bigRound}:${subRound}:${start|end}:${instanceId}`

function dispatchS7DTurnHook(
  get: () => S7DBattleStore,
  set: (partial: Partial<S7DBattleStore>) => void,
  instanceId: string,
  phase: 'start' | 'end',
): void {
  const state = get().state;
  if (!state) return;
  const key = `${state.bigRound}:${state.subRound}:${phase}:${instanceId}`;
  if (_s7dTurnHookFired.has(key)) return;
  _s7dTurnHookFired.add(key);

  const playerFaction = state.playerFaction;

  const ctx: TurnStartDispatchCtx = {
    snapshotAllUnits: () => {
      const s = get().state;
      if (!s) return [];
      return Object.values(s.units)
        .filter((u) => u.zone === 'field' && u.hp > 0)
        .map((u) => mapInstanceToEngineUnit(u, playerFaction));
    },
    applyStatChange: (uid, stat, delta, opts) => {
      const s = get().state;
      if (!s) return 0;
      const u = s.units[uid];
      if (!u) return 0;
      const floor = opts.floor ?? 1;
      let actualDelta = 0;
      if (stat === 'hp') {
        const oldHp = u.hp;
        let newHp = oldHp + delta;
        if (!opts.breakCap) newHp = Math.min(newHp, u.hpMax);
        newHp = Math.max(0, newHp);
        u.hp = newHp;
        actualDelta = newHp - oldHp;
        if (newHp <= 0) {
          u.zone = 'grave';
          u.deadAtBigRound = s.bigRound;
          u.deadAtSubRound = s.subRound;
          // 从场上移除位置占用：S7D 的实际"清场"由 killUnit 承担，这里只标 zone
        }
      } else if (stat === 'atk') {
        const oldVal = u.atk;
        let newVal = Math.max(floor, oldVal + delta);
        if (!opts.breakCap) newVal = Math.min(newVal, 99);
        u.atk = newVal;
        actualDelta = newVal - oldVal;
      } else if (stat === 'mnd') {
        const oldVal = u.mnd;
        let newVal = Math.max(floor, oldVal + delta);
        if (!opts.breakCap) newVal = Math.min(newVal, 99);
        u.mnd = newVal;
        actualDelta = newVal - oldVal;
      }
      // 触发 store 订阅刷新
      set({ state: bump(s) });
      return actualDelta;
    },
    addLog: (text, _type) => {
      const s = get().state;
      if (!s) return;
      // S7D 的 log 由 appendLog mutator 维护
      s.log.push({
        seq: (s.logSeq ?? 0) + 1,
        bigRound: s.bigRound,
        subRound: s.subRound,
        kind: 'text',
        text,
        ts: Date.now(),
      } as any);
      (s as any).logSeq = (s.logSeq ?? 0) + 1;
      set({ state: bump(s) });
    },
    getRound: () => get().state?.bigRound ?? 1,
    // ───────── 玩家弹窗能力（2026-05-11） ─────────
    isPlayerControlled: (uid) => {
      const s = get().state;
      if (!s) return false;
      const u = s.units[uid];
      if (!u) return false;
      // S7D 的玩家方判定：通过 BattlePlayer.isHuman
      const player = s.players.find((p) => p.ownerId === u.ownerId);
      return !!player && player.isHuman;
    },
    requestTurnStartChoice: (req) => {
      // 同 actor 多个 interactive 技能仅暂存第一个；dispatcher 会 continue 后续
      if (get().pendingTurnStartChoice) return;
      set({ pendingTurnStartChoice: req });
      // 写一条系统战报作为提示
      const s = get().state;
      if (s) {
        s.log.push({
          seq: (s.logSeq ?? 0) + 1,
          bigRound: s.bigRound,
          subRound: s.subRound,
          kind: 'text',
          text: `📜 「${req.promptTitle}」可发动 —— 等待玩家选择`,
          ts: Date.now(),
        } as any);
        (s as any).logSeq = (s.logSeq ?? 0) + 1;
        set({ state: bump(s) });
      }
    },
  };

  try {
    if (phase === 'start') {
      dispatchTurnStartHooks(instanceId, ctx);
    } else {
      dispatchTurnEndHooks(instanceId, ctx);
    }
  } catch (e) {
    console.error(
      `[s7dBattleStore] dispatch ${phase} hook for ${instanceId} threw:`,
      e,
    );
  }
}

/** 重置 turn-hook 去重缓存（initBattle 时调用，避免跨场污染） */
function resetS7DTurnHookCache(): void {
  _s7dTurnHookFired.clear();
}

export const useS7DBattleStore = create<S7DBattleStore>((set, get) => ({
  state: null,
  pendingTurnStartChoice: null,
  pendingRevive: null,

  // ------ 生命周期 ------

  initBattle: async (params) => {
    const fresh = await initS7DBattle(params);
    // 🔧 2026-05-11 修复：清空跨场污染的 turn-hook 去重缓存
    resetS7DTurnHookCache();
    set({ state: fresh, pendingTurnStartChoice: null, pendingRevive: null });
    // 🔧 2026-05-11 修复：为队首 actor 派发 turn_start，让 turn-start 类技能开局即生效
    if (fresh.currentActorIdx < fresh.actionQueue.length) {
      const firstActorId = fresh.actionQueue[fresh.currentActorIdx]?.instanceId;
      if (firstActorId) {
        dispatchS7DTurnHook(get, set, firstActorId, 'start');
      }
    }
    console.log(
      `[s7dBattleStore] 战场已初始化：${fresh.players.length} 玩家 / ${
        Object.keys(fresh.units).length
      } 卡实例 / 地图 18×12 / 水晶 A:${fresh.crystalA.hp} B:${fresh.crystalB.hp}`,
    );
  },

  clearBattle: () => {
    set({ state: null, pendingTurnStartChoice: null, pendingRevive: null });
  },

  // ------ 查询 ------

  getUnit: (instanceId) => {
    const s = get().state;
    if (!s) return undefined;
    return getUnit(s, instanceId);
  },
  getPlayer: (ownerId) => {
    const s = get().state;
    if (!s) return undefined;
    return getPlayer(s, ownerId);
  },
  getUnitAt: (row, col) => {
    const s = get().state;
    if (!s) return null;
    return getUnitAt(s, row, col);
  },
  getFieldUnits: (ownerId) => {
    const s = get().state;
    if (!s) return [];
    return getFieldUnits(s, ownerId);
  },
  getHandUnits: (ownerId) => {
    const s = get().state;
    if (!s) return [];
    return getHandUnits(s, ownerId);
  },
  getGraveUnits: (ownerId) => {
    const s = get().state;
    if (!s) return [];
    return getGraveUnits(s, ownerId);
  },
  getFactionFieldUnits: (faction) => {
    const s = get().state;
    if (!s) return [];
    return getFactionFieldUnits(s, faction);
  },
  getReachableCells: (instanceId) => {
    const s = get().state;
    if (!s) return [];
    return getReachableCells(s, instanceId);
  },
  getCurrentAction: () => {
    const s = get().state;
    if (!s) return undefined;
    return getCurrentAction(s);
  },
  getCurrentActor: () => {
    const s = get().state;
    if (!s) return undefined;
    return getCurrentActor(s);
  },
  getAvailableSpawns: (ownerId) => {
    const s = get().state;
    if (!s) return [];
    return getAvailableSpawnPositions(s, ownerId);
  },
  getReinforceTask: (ownerId) => {
    const s = get().state;
    if (!s) return undefined;
    return s.reinforceQueue.find((t) => t.ownerId === ownerId);
  },

  // ------ 操作 ------

  moveUnit: (instanceId, to, steps) => {
    const ret = mutate(get, set, (s) => moveUnit(s, instanceId, to, steps));
    return ret ?? false;
  },

  /**
   * 单步移动（静默版）：推进一格、累加 1 步、不写战报。
   * 用于 useBattleMapInteractions 的逐格动画 —— 总战报由调用方在动画结束后补写。
   */
  moveUnitStep: (instanceId, to) => {
    const ret = mutate(get, set, (s) => {
      const u = s.units[instanceId];
      if (!u || u.zone !== 'field' || u.hp <= 0 || !u.position) return false;
      if (u.immobilized) return false;
      // 目标格已被占（其他活着的 field 单位）→ 拒绝
      const occupied = Object.values(s.units).some(
        (other) =>
          other.instanceId !== instanceId &&
          other.zone === 'field' &&
          other.hp > 0 &&
          other.position?.row === to.row &&
          other.position?.col === to.col,
      );
      if (occupied) return false;
      u.position = { row: to.row, col: to.col };
      u.stepsUsedThisTurn += 1;
      u.hasMovedThisTurn = true;
      return true;
    });
    return ret ?? false;
  },

  damageUnit: (instanceId, amount, reason, attackerId) => {
    // 复活前的状态：是否处于"将死"
    const before = get().state?.units[instanceId];
    const wasAlive = before ? before.hp > 0 : false;

    const ret = mutate(get, set, (s) => damageUnit(s, instanceId, amount, reason, attackerId));

    // 复活后的状态：若依旧 hp>0 但 ultimateUsed 刚被设置 → 触发了复活
    const after = get().state?.units[instanceId];
    if (
      wasAlive &&
      after &&
      after.hp > 0 &&
      after.ultimateUsed &&
      // 仅玩家方
      get().state?.playerFaction === after.faction &&
      !get().pendingRevive &&
      // 仅徐立国类绝技触发
      (after.ultimateId === 'sr_xuliguo.ultimate' || after.registrySkills?.includes('sr_xuliguo.ultimate'))
    ) {
      // 弹窗让玩家分配（异步设置避免在攻击主流程中触发 rerender）
      setTimeout(() => {
        if (get().pendingRevive) return;
        set({
          pendingRevive: {
            unitId: instanceId,
            unitName: after.name,
            current: { atk: after.atk, mnd: after.mnd, hp: after.hp },
          },
        });
      }, 200);
    }

    return ret ?? 0;
  },

  healUnit: (instanceId, amount, reason) => {
    const ret = mutate(get, set, (s) => healUnit(s, instanceId, amount, reason));
    return ret ?? 0;
  },

  killUnit: (instanceId, reason, killerId) => {
    mutate(get, set, (s) => killUnit(s, instanceId, reason, killerId));
  },

  deployFromHand: (ownerId, instanceId, slot, to) => {
    const ret = mutate(get, set, (s) => deployFromHand(s, ownerId, instanceId, slot, to));
    return ret ?? { ok: false, reason: 'no_state' };
  },

  advanceActor: () => {
    // 🔧 2026-05-11 修复：在切换 actor 之前派发上一个 actor 的 on_turn_end，
    // 切换之后派发新 actor 的 on_turn_start。修复 8+ 个 turn hook 类技能从未触发的问题。
    const before = get().state;
    const prevActorId =
      before && before.currentActorIdx < before.actionQueue.length
        ? before.actionQueue[before.currentActorIdx]?.instanceId
        : undefined;
    if (prevActorId) {
      dispatchS7DTurnHook(get, set, prevActorId, 'end');
    }

    const ret = mutate(get, set, (s) => advanceActor(s));

    const after = get().state;
    if (after && after.currentActorIdx < after.actionQueue.length) {
      const newActorId = after.actionQueue[after.currentActorIdx]?.instanceId;
      if (newActorId && newActorId !== prevActorId) {
        dispatchS7DTurnHook(get, set, newActorId, 'start');
      }
    }
    return ret ?? 'blocked';
  },

  advanceSubRound: () => {
    const ret = mutate(get, set, (s) => advanceSubRound(s));
    // 🔧 2026-05-11 修复：进入新小轮次/新大回合后，为队首 actor 派发 turn_start
    if (ret === 'started') {
      const after = get().state;
      if (after && after.currentActorIdx < after.actionQueue.length) {
        const firstActorId = after.actionQueue[after.currentActorIdx]?.instanceId;
        if (firstActorId) {
          dispatchS7DTurnHook(get, set, firstActorId, 'start');
        }
      }
    }
    return ret ?? 'blocked';
  },

  checkWin: () => {
    mutate(get, set, (s) => {
      const result = checkWinCondition(s);
      if (result) {
        setWinner(s, result.winner, result.reason);
      }
    });
  },

  log: (text) => {
    mutate(get, set, (s) => appendLog(s, 'text', text));
  },

  useBattleSkill: (casterId, targetIds) => {
    const ret = mutate(get, set, (s) => castSkillAndApply(s, casterId, 'battle', targetIds));
    return ret ?? false;
  },

  useUltimate: (casterId, targetIds) => {
    const ret = mutate(get, set, (s) => castSkillAndApply(s, casterId, 'ultimate', targetIds));
    return ret ?? false;
  },

  performAttack: (attackerId, defenderId, fengshuOverride) => {
    const ret = mutate(get, set, (s) => attackAndApply(s, attackerId, defenderId, fengshuOverride));
    return ret ?? null;
  },

  computeFengShuCandidates: (attackerId, defenderId) => {
    const s = get().state;
    if (!s) return [];
    return computeFengShuCandidatesS7D(s, attackerId, defenderId);
  },

  scanAwakenings: () => {
    mutate(get, set, (s) => checkAndTriggerAwakening(s));
  },

  // ─────────────────────────────────────────────────────────────
  // 玩家可控的 turn-start 选择确认 / 拒绝（2026-05-11 玩家选择弹窗）
  // ─────────────────────────────────────────────────────────────
  confirmTurnStartChoice: (targetId, stat) => {
    const pending = get().pendingTurnStartChoice;
    if (!pending) return;
    const state = get().state;
    if (!state) {
      set({ pendingTurnStartChoice: null });
      return;
    }
    const playerFaction = state.playerFaction;
    const ctx: TurnStartDispatchCtx = {
      snapshotAllUnits: () => {
        const s = get().state;
        if (!s) return [];
        return Object.values(s.units)
          .filter((u) => u.zone === 'field' && u.hp > 0)
          .map((u) => mapInstanceToEngineUnit(u, playerFaction));
      },
      applyStatChange: (uid, st, delta, opts) => {
        const s = get().state;
        if (!s) return 0;
        const u = s.units[uid];
        if (!u) return 0;
        const floor = opts.floor ?? 1;
        let actualDelta = 0;
        if (st === 'hp') {
          const oldHp = u.hp;
          let newHp = oldHp + delta;
          if (!opts.breakCap) newHp = Math.min(newHp, u.hpMax);
          newHp = Math.max(0, newHp);
          if (delta < 0 && opts.floor !== undefined) {
            newHp = Math.max(newHp, oldHp + Math.min(0, opts.floor - oldHp));
          }
          u.hp = newHp;
          actualDelta = newHp - oldHp;
          if (newHp <= 0) {
            u.zone = 'grave';
            u.deadAtBigRound = s.bigRound;
            u.deadAtSubRound = s.subRound;
          }
        } else if (st === 'atk') {
          const oldVal = u.atk;
          let newVal = Math.max(floor, oldVal + delta);
          if (!opts.breakCap) newVal = Math.min(newVal, 99);
          u.atk = newVal;
          actualDelta = newVal - oldVal;
        } else if (st === 'mnd') {
          const oldVal = u.mnd;
          let newVal = Math.max(floor, oldVal + delta);
          if (!opts.breakCap) newVal = Math.min(newVal, 99);
          u.mnd = newVal;
          actualDelta = newVal - oldVal;
        }
        set({ state: bump(s) });
        return actualDelta;
      },
      addLog: (text) => {
        const s = get().state;
        if (!s) return;
        s.log.push({
          seq: (s.logSeq ?? 0) + 1,
          bigRound: s.bigRound,
          subRound: s.subRound,
          kind: 'text',
          text,
          ts: Date.now(),
        } as any);
        (s as any).logSeq = (s.logSeq ?? 0) + 1;
        set({ state: bump(s) });
      },
      getRound: () => get().state?.bigRound ?? 1,
    };
    try {
      applyTurnStartChoice(pending.actorId, pending.skillId, targetId, stat, ctx);
    } catch (e) {
      console.error('[s7dBattleStore] applyTurnStartChoice threw:', e);
    }
    set({ pendingTurnStartChoice: null });
  },
  cancelTurnStartChoice: () => {
    const pending = get().pendingTurnStartChoice;
    if (!pending) return;
    const state = get().state;
    if (state) {
      state.log.push({
        seq: (state.logSeq ?? 0) + 1,
        bigRound: state.bigRound,
        subRound: state.subRound,
        kind: 'text',
        text: `📜 玩家放弃发动「${pending.promptTitle}」`,
        ts: Date.now(),
      } as any);
      (state as any).logSeq = (state.logSeq ?? 0) + 1;
      set({ state: bump(state) });
    }
    set({ pendingTurnStartChoice: null });
  },

  // ===== 复活分配确认 / 取消（2026-05-11 ReviveAllocateModal）=====
  confirmReviveAllocate: (payload) => {
    const pending = get().pendingRevive;
    if (!pending) return;
    if (payload.atk + payload.mnd + payload.hp !== 8) {
      set({ pendingRevive: null });
      return;
    }
    mutate(get, set, (s) => {
      const u = s.units[pending.unitId];
      if (u) {
        u.atk = payload.atk;
        u.mnd = payload.mnd;
        u.hp = payload.hp;
        u.hpMax = Math.max(u.hpMax, payload.hp);
        s.log.push({
          seq: (s.logSeq ?? 0) + 1,
          bigRound: s.bigRound,
          subRound: s.subRound,
          kind: 'skill_cast',
          text: `✨ 天罡元婴·重塑：${pending.unitName} 重新分配 → 修为 ${payload.atk} / 心境 ${payload.mnd} / 气血 ${payload.hp}`,
          ts: Date.now(),
        } as any);
        (s as any).logSeq = (s.logSeq ?? 0) + 1;
      }
    });
    set({ pendingRevive: null });
  },
  cancelReviveAllocate: () => {
    const pending = get().pendingRevive;
    if (!pending) return;
    const state = get().state;
    if (state) {
      state.log.push({
        seq: (state.logSeq ?? 0) + 1,
        bigRound: state.bigRound,
        subRound: state.subRound,
        kind: 'text',
        text: `📜 玩家保持默认复活分配（修为 ${pending.current.atk} / 心境 ${pending.current.mnd} / 气血 ${pending.current.hp}）`,
        ts: Date.now(),
      } as any);
      (state as any).logSeq = (state.logSeq ?? 0) + 1;
      set({ state: bump(state) });
    }
    set({ pendingRevive: null });
  },

  // ===== DEBUG 专用：强制结束战斗（仅测试用，生产前删除或加开关）=====
  debugForceEnd: (winner: 'A' | 'B' | 'draw', reason: 'crystal_broken' | 'all_dead' | 'timeout' = 'crystal_broken') => {
    mutate(get, set, (s) => {
      setWinner(s, winner as any, reason);
    });
  },
}));

// ==========================================================================
// 辅助工具：供外部直接读取整份 state（常用于渲染选择器）
// ==========================================================================

export function useS7DBattleState<T>(selector: (s: S7DBattleState | null) => T): T {
  return useS7DBattleStore((store) => selector(store.state));
}
