/**
 * S7D · 简化版 AI 决策（Batch 1）
 *
 * 目的：让战斗能走通，5 个 AI 不用差异化，统一用启发式：
 *   1. 如果能攻击敌方棋子 → 挑血量最低的敌人攻击
 *   2. 否则如果能攻击敌方水晶 → 攻击水晶
 *   3. 否则向最近敌人移动（能动多远就动多远）
 *   4. 都不行 → 结束回合
 *
 * Batch 3 会扩展为 5 个主角差异化的决策树（激进/防守/辅助等）。
 *
 * ⚠️ 本文件返回的是"建议动作"，实际执行由 S7D_Battle 页面统一调用 Store API。
 *    这样便于把 AI 的行动也走到骰子弹窗动画流程里。
 */

import type {
  BattleCardInstance,
  BattleFaction,
  GridPos,
  S7DBattleState,
} from '@/types/s7dBattle';
import {
  getAttackableEnemies,
  manhattan,
} from './s7dBattleCombat';
import { getReachableCells, getFactionFieldUnits } from './s7dBattleQueries';

/**
 * AI 行动决策结果（3 种之一）
 *
 * 注：规则 v2 后水晶不可主动攻击，仅保留 attack_unit / move / pass。
 * 遗留的 attack_crystal kind 保留仅为类型兼容，实际不再返回。
 */
export type AiAction =
  | { kind: 'attack_unit'; targetInstanceId: string }
  | { kind: 'attack_crystal'; targetFaction: BattleFaction }
  | { kind: 'move_then_maybe_attack'; to: GridPos; steps: number }
  | { kind: 'pass' };

/**
 * 为单个行动者计算 AI 动作
 */
export function decideAiAction(
  state: S7DBattleState,
  actorInstanceId: string,
): AiAction {
  const actor = state.units[actorInstanceId];
  if (!actor || actor.hp <= 0 || actor.zone !== 'field' || !actor.position) {
    return { kind: 'pass' };
  }

  const allUnits = Object.values(state.units);
  const enemyFaction: BattleFaction = actor.faction === 'A' ? 'B' : 'A';

  // 1. 能攻击相邻敌方棋子 → 挑血量最低的
  if (!actor.attackedThisTurn) {
    const attackable = getAttackableEnemies(actor, allUnits);
    if (attackable.length > 0) {
      const target = attackable.reduce((lo, u) => (u.hp < lo.hp ? u : lo), attackable[0]);
      return { kind: 'attack_unit', targetInstanceId: target.instanceId };
    }
    // 规则 v2：水晶不可被主动攻击，只能通过占领水晶格在大回合末结算
    // 所以这里不再尝试 attack_crystal
  }

  // 3. 移动：优先冲向敌方水晶（推进占领），否则冲向最近敌人
  if (!actor.immobilized && actor.stepsUsedThisTurn < actor.mnd) {
    const reachable = getReachableCells(state, actorInstanceId);
    if (reachable.length > 0) {
      // 3a. 优先：最接近敌方水晶的格子
      const enemyCrystal = enemyFaction === 'A' ? state.crystalA : state.crystalB;
      const targetCrystalCenter = averagePos(enemyCrystal.positions);

      // 3b. 也考虑最近敌人
      const enemies = getFactionFieldUnits(state, enemyFaction);
      const nearestEnemy = enemies.length
        ? enemies.reduce(
            (best, e) =>
              e.position && manhattan(actor.position!, e.position) < manhattan(actor.position!, best.position!)
                ? e
                : best,
            enemies[0],
          )
        : null;

      // 取两者中"更有价值"的目标（简化：距离敌方水晶更近且至少不远离敌人）
      const targetPos = targetCrystalCenter; // Batch 1 简化：一律奔向敌方水晶

      // 从可达格中挑最接近目标的
      let best: GridPos = reachable[0];
      let bestDist = manhattan(reachable[0], targetPos);
      for (const c of reachable) {
        const d = manhattan(c, targetPos);
        if (d < bestDist) {
          best = c;
          bestDist = d;
        }
      }

      // 只有当移动后确实靠近目标（或能进入攻击距离）才行动
      const curDist = manhattan(actor.position, targetPos);
      if (bestDist < curDist) {
        // 计算步数（曼哈顿距离近似；精确值需 BFS 路径重建，Batch 1 暂简化）
        const steps = Math.min(actor.mnd - actor.stepsUsedThisTurn, manhattan(actor.position, best));
        return { kind: 'move_then_maybe_attack', to: best, steps };
      }

      // 否则考虑靠近最近敌人
      if (nearestEnemy?.position) {
        let best2: GridPos = reachable[0];
        let bestDist2 = manhattan(reachable[0], nearestEnemy.position);
        for (const c of reachable) {
          const d = manhattan(c, nearestEnemy.position);
          if (d < bestDist2) {
            best2 = c;
            bestDist2 = d;
          }
        }
        const curDist2 = manhattan(actor.position, nearestEnemy.position);
        if (bestDist2 < curDist2) {
          const steps = Math.min(actor.mnd - actor.stepsUsedThisTurn, manhattan(actor.position, best2));
          return { kind: 'move_then_maybe_attack', to: best2, steps };
        }
      }
    }
  }

  return { kind: 'pass' };
}

/** 计算一组格子的平均位置（用于水晶中心） */
function averagePos(positions: GridPos[]): GridPos {
  if (positions.length === 0) return { row: 0, col: 0 };
  let rSum = 0;
  let cSum = 0;
  for (const p of positions) {
    rSum += p.row;
    cSum += p.col;
  }
  return { row: Math.round(rSum / positions.length), col: Math.round(cSum / positions.length) };
}
