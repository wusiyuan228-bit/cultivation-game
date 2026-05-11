/**
 * Store ↔ Flow 适配器（2026-05-11 方案A · 流程钩子层）
 *
 * 任务：让任何 store 不需要重复实现"我自己怎么从 unit 列表查 actor / 怎么 mutate 单位"
 *      —— 提供一个最小契约接口 BattleStoreAdapter，dispatcher 与 host 共享。
 *
 * 设计要点：
 *   1. 不直接 import 任何 store —— 避免循环依赖
 *   2. adapter 由 store 在调用 dispatchTurnStartHooks 时构造（一次性临时对象）
 *   3. UI 层也通过同一份 adapter 把 confirm/cancel 转发到 store
 *
 * 复用现状：
 *   - turnStartDispatcher.ts 已存在等价的 TurnStartDispatchCtx
 *   - 本文件作为它的统一升级版，未来其他 dispatcher（followUp/onHit）共用同一接口
 */

import type { BattleUnit as EngineUnit } from '../types';
import type { PendingChoice } from './pendingChoice';

/**
 * 战斗 Store 必须满足的最小契约：
 *   - 任何 store（battleStore / s7bBattleStore / s7dBattleStore）实现这 7 个回调即可接入流程层
 *   - dispatcher / host 不会触碰 store 的私有状态
 */
export interface BattleStoreAdapter {
  /** 把 store 内所有 unit 映射成 EngineUnit 数组（dispatcher 每次都重新调用以拿最新值） */
  snapshotAllUnits: () => EngineUnit[];

  /** 修改 unit 属性（写回 store + emit 战报） */
  applyStatChange: (
    unitId: string,
    stat: 'hp' | 'atk' | 'mnd',
    delta: number,
    opts: {
      permanent: boolean;
      breakCap?: boolean;
      floor?: number;
      reason: string;
      skillId?: string;
    },
  ) => number;

  /** 写一条战报 */
  addLog: (
    text: string,
    type?: 'system' | 'skill' | 'damage' | 'kill' | 'action',
  ) => void;

  /** 当前大回合数 */
  getRound: () => number;

  /** 全局 seq（用于 modifier id） */
  nextSeq?: () => number;

  /** 该 unitId 是否由真实玩家控制（玩家方第一行动者，非 AI） */
  isPlayerControlled?: (unitId: string) => boolean;

  /**
   * 提交一个 PendingChoice 到 store，由 store 写到自己的 pendingChoice 字段。
   * UI 监听 pendingChoice → 渲染对应弹窗。
   *
   * 若 store 未实现此回调（如还没接入新架构的旧 store），dispatcher 会退化为
   * 旧的 requestTurnStartChoice 路径。
   */
  submitPendingChoice?: (choice: PendingChoice) => void;
}

/**
 * 类型标签：用于在 store 内部判断"我是否已经持有某种待选弹窗"
 *   防止行动轮切换瞬间 dispatcher 重复触发同一弹窗
 */
export function getPendingChoiceTag(c: PendingChoice | null | undefined): string | null {
  if (!c) return null;
  if (c.kind === 'turn_start_skill') {
    return `${c.kind}:${c.actorId}:${c.skillId}`;
  }
  if (c.kind === 'fengshu_pick') {
    return `${c.kind}:${c.attackerId}:${c.defenderId}`;
  }
  return null;
}
