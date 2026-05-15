/**
 * S7D · 战场地块（功能瓦片）结算
 *
 * 规则（与 S7/S7B 保持一致）：
 *   - 💚 spring    生命泉  · 停留至下回合开始 → 气血 +1（不破上限）
 *   - ⚔️ atk_boost 修为台  · 停留至下回合开始 → 修为 +1（永久）
 *   - 🧘 mnd_boost 心境坛  · 停留至下回合开始 → 心境 +1（永久）
 *   - 🔥 miasma    魔瘴地  · 停留至下回合开始 → 气血 -1
 *
 * "停留至下回合开始"判定：
 *   - 在该 actor 行动结束时记录 `lastTerrain = 当前格地块`
 *   - 在该 actor 下一次行动开始时检查：若 `lastTerrain === 当前格地块`
 *     说明从上回合结束到这回合开始一直没离开 → 触发结算
 *   - 触发后清空 lastTerrain，避免一直站在原格反复触发（与 S7/S7B 一致）
 *
 * 注：S7D 战场之前完全没有实现地块结算逻辑（s7dBattleStore 内零相关代码），
 *     是个多月遗留 bug。本文件补齐对齐 S7B 行为。
 */

import type { S7DBattleState, BattleCardInstance } from '@/types/s7dBattle';
import {
  isAtkBoost,
  isSpring,
  isMndBoost,
  isMiasma,
  type S7DTileType,
} from '@/data/s7dMap';
import { appendLog } from './s7dBattleActions';

/**
 * 仅返回"功能瓦片"类型（spring/atk_boost/mnd_boost/miasma），
 * 普通格 / 河道 / 桥 / 出生点 / 水晶等返回 null。
 */
export function getFunctionalTerrainAt(
  row: number,
  col: number,
): Extract<S7DTileType, 'spring' | 'atk_boost' | 'mnd_boost' | 'miasma'> | null {
  if (isAtkBoost(row, col)) return 'atk_boost';
  if (isSpring(row, col)) return 'spring';
  if (isMndBoost(row, col)) return 'mnd_boost';
  if (isMiasma(row, col)) return 'miasma';
  return null;
}

/**
 * 在某 actor 行动结束时记录其当前位置的功能瓦片。
 * 之后该 actor 在下一次行动开始时会被 applyS7DTerrainEffectOnTurnStart 检测到。
 *
 * 设计要点：
 *   - 仅记录"功能瓦片"。普通格 / 桥 / 出生点 / 水晶等记为 null
 *     这样原本站在功能瓦片上、本回合移开到普通格的，下回合开始也不会被错触发。
 *   - 已 zone='grave' / hp<=0 的不记录。
 */
export function recordTerrainOnTurnEnd(
  state: S7DBattleState,
  instanceId: string,
): void {
  const u: BattleCardInstance | undefined = state.units[instanceId];
  if (!u || u.zone !== 'field' || u.hp <= 0 || !u.position) {
    return;
  }
  const t = getFunctionalTerrainAt(u.position.row, u.position.col);
  u.lastTerrain = t; // 普通格记 null
}

/**
 * 在某 actor 行动开始时结算地块效果。
 *
 * 触发条件：
 *   - actor 上回合结束时记录的 lastTerrain 与本回合开始时的当前格地块"完全一致"
 *     （即从上回合结束 → 本回合开始没离开过该格）
 *
 * 结算后立即把 lastTerrain 清为当前格的地块（修为台/心境坛/生命泉/魔瘴地之外即 null），
 * 避免下次回合再次重复触发（玩家若想再次触发需要离开该格再回来）。
 *
 * 致命情况（魔瘴地把 hp 扣到 0）：
 *   - 由调用方观察 hp 后走 killUnit（本函数仅修改 hp 并写战报，不直接 killUnit，
 *     因为 killUnit 会发起补位流程，应由 store 层统一调度）
 *
 * @returns 是否真的触发了一次结算（用于调用方判定要不要后续 reconcile）
 */
export function applyS7DTerrainEffectOnTurnStart(
  state: S7DBattleState,
  instanceId: string,
): boolean {
  const u: BattleCardInstance | undefined = state.units[instanceId];
  if (!u || u.zone !== 'field' || u.hp <= 0 || !u.position) {
    return false;
  }

  const currentTerrain = getFunctionalTerrainAt(u.position.row, u.position.col);
  // 不在功能瓦片上 → 直接清零 lastTerrain 并退出
  if (!currentTerrain) {
    if (u.lastTerrain) u.lastTerrain = null;
    return false;
  }

  // 上回合结束时不在同一功能瓦片上 → 不触发，但要更新 lastTerrain 为当前格
  if (u.lastTerrain !== currentTerrain) {
    // 注意这里**不更新** lastTerrain：lastTerrain 应当只在"行动结束"时被刷新，
    // 否则连续两小轮次同 actor 的逻辑会错乱。
    return false;
  }

  // ──── 触发结算 ────
  let triggered = false;
  switch (currentTerrain) {
    case 'spring': {
      if (u.hp < u.hpMax) {
        const before = u.hp;
        u.hp = Math.min(u.hp + 1, u.hpMax);
        appendLog(
          state,
          'heal',
          `💚 ${u.name} 停留在生命泉，气血 +1（${before}→${u.hp}/${u.hpMax}）`,
          { targetIds: [instanceId], payload: { terrain: 'spring' } },
        );
        triggered = true;
      }
      break;
    }
    case 'atk_boost': {
      const before = u.atk;
      u.atk = Math.min(u.atk + 1, 99);
      appendLog(
        state,
        'text',
        `⚔️ ${u.name} 停留在修为台，修为 +1（${before}→${u.atk}，永久）`,
        { targetIds: [instanceId], payload: { terrain: 'atk_boost' } },
      );
      triggered = true;
      break;
    }
    case 'mnd_boost': {
      const before = u.mnd;
      u.mnd = Math.min(u.mnd + 1, 99);
      appendLog(
        state,
        'text',
        `🧘 ${u.name} 停留在心境坛，心境 +1（${before}→${u.mnd}，永久）`,
        { targetIds: [instanceId], payload: { terrain: 'mnd_boost' } },
      );
      triggered = true;
      break;
    }
    case 'miasma': {
      const before = u.hp;
      u.hp = Math.max(0, u.hp - 1);
      appendLog(
        state,
        'damage',
        `🔥 ${u.name} 停留在魔瘴地，气血 -1（${before}→${u.hp}/${u.hpMax}）`,
        { targetIds: [instanceId], payload: { terrain: 'miasma', amount: 1 } },
      );
      triggered = true;
      // 注：致死处理由 store 层负责（避免在工具函数内发起 reinforceQueue）
      break;
    }
  }

  // 触发后立即清空 lastTerrain，防止重复触发
  if (triggered) {
    u.lastTerrain = null;
  }

  return triggered;
}
