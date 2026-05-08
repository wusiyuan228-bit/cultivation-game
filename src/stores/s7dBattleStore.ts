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
import {
  attackAndApply,
  checkAndTriggerAwakening,
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
  performAttack: (attackerId: string, defenderId: string) => AttackOutcome | null;
  /** 手动触发觉醒扫描（Batch 2C） */
  scanAwakenings: () => void;

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

export const useS7DBattleStore = create<S7DBattleStore>((set, get) => ({
  state: null,

  // ------ 生命周期 ------

  initBattle: async (params) => {
    const fresh = await initS7DBattle(params);
    set({ state: fresh });
    console.log(
      `[s7dBattleStore] 战场已初始化：${fresh.players.length} 玩家 / ${
        Object.keys(fresh.units).length
      } 卡实例 / 地图 18×12 / 水晶 A:${fresh.crystalA.hp} B:${fresh.crystalB.hp}`,
    );
  },

  clearBattle: () => {
    set({ state: null });
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

  damageUnit: (instanceId, amount, reason, attackerId) => {
    const ret = mutate(get, set, (s) => damageUnit(s, instanceId, amount, reason, attackerId));
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
    const ret = mutate(get, set, (s) => advanceActor(s));
    return ret ?? 'blocked';
  },

  advanceSubRound: () => {
    const ret = mutate(get, set, (s) => advanceSubRound(s));
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

  performAttack: (attackerId, defenderId) => {
    const ret = mutate(get, set, (s) => attackAndApply(s, attackerId, defenderId));
    return ret ?? null;
  },

  scanAwakenings: () => {
    mutate(get, set, (s) => checkAndTriggerAwakening(s));
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
