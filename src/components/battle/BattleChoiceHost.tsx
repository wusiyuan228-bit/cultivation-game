/**
 * BattleChoiceHost — 战斗弹窗统一主机
 *
 * 2026-05-11 方案A · 流程钩子层
 *
 * 职责：
 *   监听 store.pendingChoice，根据 kind 自动渲染对应弹窗组件。
 *   3 个战斗界面（S7_Battle / S7B_Battle / S7D_Battle）只需要挂一个本组件，
 *   就自动支持所有 PendingChoice 类型。
 *
 * 当前接入：
 *   - 'turn_start_skill' → TurnStartChoiceModal（已实装）
 *   - 'fengshu_pick'     → 风属斗技 ask 阶段也用同一模态弹窗；picking 阶段由
 *                          各战斗界面自己渲染棋盘高亮（落在地图坐标上，全屏弹窗
 *                          无法覆盖此交互）
 *
 * 后续每加一种新 PendingChoice：在 switch 加一个 case，引入对应弹窗组件即可。
 */

import type { PendingChoice } from '@/systems/battle/flow/pendingChoice';
import { TurnStartChoiceModal } from './TurnStartChoiceModal';

/** 与 TurnStartChoiceModal.resolveUnit 同形：仅展示用 */
export interface ResolveUnitFn {
  (id: string): {
    id: string;
    name: string;
    hp: number;
    hpMax: number;
    atk: number;
    mnd: number;
    isEnemy?: boolean;
  } | null;
}

export interface BattleChoiceHostProps {
  /** 来自 store 的 pendingChoice（null 时不渲染任何弹窗） */
  pending: PendingChoice | null;
  /** 把 unit id 映射成展示对象 */
  resolveUnit: ResolveUnitFn;

  /** turn-start 弹窗：玩家点确认 */
  onTurnStartConfirm?: (
    targetId: string,
    stat: 'atk' | 'mnd' | 'hp' | undefined,
  ) => void;
  /** turn-start 弹窗：玩家点放弃 */
  onTurnStartCancel?: () => void;

  /** 风属斗技 ask 弹窗：玩家点发动（进入棋盘选位阶段） */
  onFengShuActivate?: () => void;
  /** 风属斗技 ask 弹窗：玩家点不发动（直接攻击不传送） */
  onFengShuSkip?: () => void;
}

export function BattleChoiceHost({
  pending,
  resolveUnit,
  onTurnStartConfirm,
  onTurnStartCancel,
  onFengShuActivate: _onFengShuActivate,
  onFengShuSkip: _onFengShuSkip,
}: BattleChoiceHostProps) {
  if (!pending) return null;

  switch (pending.kind) {
    case 'turn_start_skill':
      return (
        <TurnStartChoiceModal
          pending={{
            actorId: pending.actorId,
            skillId: pending.skillId,
            promptTitle: pending.promptTitle,
            promptBody: pending.promptBody,
            choices: pending.choices,
          }}
          resolveUnit={resolveUnit}
          onConfirm={(t, s) => onTurnStartConfirm?.(t, s)}
          onCancel={() => onTurnStartCancel?.()}
        />
      );

    case 'fengshu_pick':
      // 当前仍由各战斗界面自管 ask/picking 弹窗与棋盘高亮，
      // 此 case 留作迁移完成后的接入位（Commit 3）
      return null;

    default:
      return null;
  }
}
