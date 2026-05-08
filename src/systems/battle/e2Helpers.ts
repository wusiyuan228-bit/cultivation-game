/**
 * 阶段 E2 · 复杂交互 store 层工具
 *
 * 职责：
 *   1. 持久化全局 ModifierStore（替代各个 adapter 中临时 noop 的实现）
 *   2. 位移/交换/复活/蛊惑等需要"改地图格子"的副作用，由这里派发给 store 层钩子
 *
 * 设计：
 *   - 本模块只暴露纯函数式工具，不直接依赖 zustand store（避免循环依赖）
 *   - store 层通过 registerE2Callbacks 注册自身的 set/get，再由本模块在需要时回调
 */

import { ModifierStore } from './modifierSystem';
import type { Modifier } from './types';

/* ============================================================== */
/*  全局 ModifierStore 单例（所有 adapter 共享）                   */
/* ============================================================== */
export const globalModStore = new ModifierStore();

/** 便捷：重置（用于 initBattle / reset）*/
export function resetGlobalModStore(): void {
  globalModStore.clear();
}

/** 便捷：查询某单位某 kind 的全部 modifier */
export function queryMods(unitId: string, kind: Modifier['kind']): Modifier[] {
  return globalModStore.query(unitId, kind);
}

/* ============================================================== */
/*  位移/交换/复活/蛊惑的 store 层回调注册表                        */
/* ============================================================== */

export interface E2StoreCallbacks {
  /**
   * 尝试把 victimId 强制传送到 anchorId 相邻 2 格范围内的任意空位
   * @returns 成功则返回 { row, col }，无合法落点返回 null
   *          (Q-E2-1 方案 B：由 caller 决定失败后的动作 —— 在攻击入口调用时应整个取消攻击)
   */
  teleportToAnchorAdjacent: (
    victimId: string,
    anchorId: string,
    radius: number,
  ) => { row: number; col: number } | null;

  /**
   * 交换两个单位的位置
   */
  swapUnits: (aId: string, bId: string) => boolean;

  /**
   * 复活已退场单位到指定格（若 targetPos 未指定则用其原位置或最近空位）
   */
  reviveUnit: (unitId: string, hp: number) => boolean;

  /**
   * 在目标下一个行动轮开始时，若挂有 force_attack modifier（红蝶蛊惑）：
   *   - 按 id 字典序依次攻击其原相邻己方单位
   *   - 全部攻击完毕后跳过本轮其他操作（自动 endUnitTurn）
   *   - 消费并驱散该 modifier
   * @returns 是否触发了蛊惑（触发后 caller 无需再走正常 AI/玩家流程）
   */
  resolveCharmIfAny: (unitId: string) => boolean;

  /**
   * 在攻击入口调用：检查攻击者是否携带"风属斗技"，若是则预演传送
   *   - 有合法落点：返回 { ok: true, pos } —— 攻击继续，攻击结束后由 store 应用 pos
   *   - 无合法落点：返回 { ok: false } —— 按 Q-E2-1 方案 B 整个攻击取消
   *   - 不携带风属斗技：返回 { ok: true } —— 正常攻击
   */
  prepareFengShuTeleport: (
    attackerId: string,
    defenderId: string,
  ) => { ok: true; pos?: { row: number; col: number } } | { ok: false; reason: string };
}

let _cbs: E2StoreCallbacks | null = null;

export function registerE2Callbacks(cbs: E2StoreCallbacks): void {
  _cbs = cbs;
}

export function getE2Callbacks(): E2StoreCallbacks | null {
  return _cbs;
}

/* ============================================================== */
/*  攻击入口的 stat_set 应用（镜像肠 / 化形镜像）                   */
/* ============================================================== */
/**
 * 查询某单位的 stat_set modifier，返回最高 priority 的值（若存在）
 * 用于 attack 入口修正 diceAttack
 */
export function resolveStatSet(
  unitId: string,
  stat: 'atk' | 'mnd' | 'hp',
): number | null {
  const mods = globalModStore.query(unitId, 'stat_set');
  for (const m of mods) {
    const p = m.payload as { stat?: string; setTo?: number };
    if (p?.stat === stat && typeof p.setTo === 'number') {
      return p.setTo;
    }
  }
  return null;
}

/* ============================================================== */
/*  攻击入口的 force_attack modifier 查询（红蝶蛊惑）              */
/* ============================================================== */
/**
 * 查询蛊惑 modifier：
 *   - 如果是 next_turn（刚刚施加），本轮不触发，转为 this_turn
 *   - 如果是 this_turn，本轮触发
 *   - 返回待消费的 modifier（this_turn），否则 null
 */
export function queryCharmTarget(unitId: string): Modifier | null {
  const mods = globalModStore.query(unitId, 'force_attack');
  if (mods.length === 0) return null;
  // 先把 next_turn → this_turn（模拟 cleanupOnTurnStart 的效果）
  for (const m of mods) {
    if (m.duration.type === 'next_turn' && m.duration.turnOwnerId === unitId) {
      m.duration = { type: 'this_turn', turnOwnerId: unitId };
      return null; // 本轮刚转，下一轮才触发
    }
  }
  // 再找 this_turn 的
  for (const m of mods) {
    if (m.duration.type === 'this_turn' && m.duration.turnOwnerId === unitId) {
      return m;
    }
  }
  return null;
}
