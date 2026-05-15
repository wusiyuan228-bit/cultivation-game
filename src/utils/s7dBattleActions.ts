/**
 * S7D · 战场操作工具（mutation helper，均作用于 draft state）
 *
 * 设计原则：
 *   - 每个函数都接收 state（draft）并直接修改，配合 immer 在 Store 里使用
 *   - 所有状态变更都自动 emit 战报
 *   - 职责单一：每个 action 只做一件事，Store 里组合调用
 *
 * 主要 API：
 *   - moveUnit           移动单位到指定格
 *   - damageUnit         对单位造成伤害（可触发阵亡）
 *   - killUnit           直接击杀（挪到弃牌区）
 *   - deployFromHand     从手牌区补位到战斗区
 *   - startSubRound      开始某小轮次（构造行动队列）
 *   - advanceActor       推进当前行动者指针
 *   - resolveCrystalDamage  大回合结束的水晶占领结算
 *   - advanceToNextRound 进入下一大回合
 *   - checkAndSetWinner  胜负检测并写入
 */

import type {
  BattleCardInstance,
  BattleFaction,
  BattleOwnerId,
  FieldSlot,
  GridPos,
  ReinforceTask,
  S7DBattleLog,
  S7DBattleState,
  S7DLogKind,
} from '@/types/s7dBattle';
import {
  checkWinCondition,
  getCrystalOccupants,
  getHandUnits,
  getPlayer,
  isCellOccupied,
} from './s7dBattleQueries';
import { buildActionQueue } from './s7dBattleInit';
import {
  S7D_SPAWN_A,
  S7D_SPAWN_B,
  isSpawnA,
  isSpawnB,
} from '@/data/s7dMap';
import {
  shouldTryRevive,
  DEFAULT_REVIVE_PAYLOAD,
  reviveLogText,
} from '@/systems/battle/reviveCheck';

// ==========================================================================
// 战报辅助
// ==========================================================================

export function appendLog(
  state: S7DBattleState,
  kind: S7DLogKind,
  text: string,
  extras?: Partial<Omit<S7DBattleLog, 'seq' | 'kind' | 'text' | 'bigRound'>>,
): void {
  // 🔧 2026-05-15 dev-only 警告：移动/攻击/技能/伤害类事件必须带 actorId
  //   防止再出现"玩家移动落入 kind=text"这种隐式 bug。
  if (
    import.meta.env?.DEV &&
    (kind === 'move' || kind === 'attack' || kind === 'skill_cast' || kind === 'damage') &&
    !extras?.actorId
  ) {
    // eslint-disable-next-line no-console
    console.warn(
      `[s7dBattle][appendLog] kind="${kind}" 缺少 actorId，将影响日志检索：${text}`,
    );
  }
  state.logSeq += 1;
  const entry: S7DBattleLog = {
    seq: state.logSeq,
    bigRound: state.bigRound,
    subRound: state.subRound,
    kind,
    text,
    ...extras,
  };
  state.log.push(entry);
}

// ==========================================================================
// 移动
// ==========================================================================

/**
 * 将单位移动到指定位置（不做路径校验，由上层 getReachableCells 保证合法）。
 * 会扣减 stepsUsedThisTurn 并 emit 'move' 战报。
 */
export function moveUnit(
  state: S7DBattleState,
  instanceId: string,
  to: GridPos,
  steps: number,
): boolean {
  const u = state.units[instanceId];
  if (!u || u.zone !== 'field' || u.hp <= 0 || !u.position) return false;
  if (u.immobilized) return false;
  if (isCellOccupied(state, to.row, to.col)) return false;

  const from = { ...u.position };
  u.position = { row: to.row, col: to.col };
  u.stepsUsedThisTurn += steps;
  u.hasMovedThisTurn = true;

  appendLog(
    state,
    'move',
    `${u.name} 从 (${from.row},${from.col}) 移动至 (${to.row},${to.col}) · 消耗 ${steps} 步`,
    { actorId: instanceId, payload: { from, to, steps } },
  );
  return true;
}

// ==========================================================================
// 伤害与阵亡
// ==========================================================================

/**
 * 对单位造成伤害（简化版，不走完整引擎 hook）。
 * 若 hp 降至 0 → 自动触发阵亡流程（killUnit）。
 * 返回实际扣血量。
 */
export function damageUnit(
  state: S7DBattleState,
  instanceId: string,
  amount: number,
  reason: string,
  attackerId?: string,
): number {
  const u = state.units[instanceId];
  if (!u || u.hp <= 0) return 0;

  const actual = Math.min(u.hp, Math.max(0, amount));
  u.hp -= actual;

  appendLog(state, 'damage', `${u.name} 受到 ${actual} 点伤害（${reason}）· 剩余 ${u.hp}/${u.hpMax}`, {
    actorId: attackerId,
    targetIds: [instanceId],
    payload: { amount: actual, reason },
  });

  if (u.hp <= 0) {
    // ─────────────────────────────────────────────────────
    // 2026-05-11 复活机制：天罡元婴·重塑（徐立国）
    //   死亡瞬间检查：若该单位拥有 sr_xuliguo.ultimate 且未触发过 →
    //   原地复活（atk=3, mnd=2, hp=3，本场限 1 次）
    // ─────────────────────────────────────────────────────
    if (shouldTryRevive(u as any)) {
      const p = DEFAULT_REVIVE_PAYLOAD;
      u.hp = p.hp;
      u.atk = p.atk;
      u.mnd = p.mnd;
      u.hpMax = Math.max(u.hpMax, p.hp);
      u.ultimateUsed = true;
      appendLog(state, 'skill_cast', reviveLogText(u.name, p, 'auto'), {
        actorId: instanceId,
        targetIds: [instanceId],
        payload: { skillId: 'sr_xuliguo.ultimate', revive: true, ...p },
      });
    } else {
      killUnit(state, instanceId, reason, attackerId);
    }
  }
  return actual;
}

/**
 * 击杀单位：挪到弃牌区，释放战斗区槽位，发起补位请求。
 *
 * ⚠️ 关于行动队列处理（规则 v2）：
 *   - 若死者在当前 actionQueue 中尚未行动（acted=false），则标记 skipped=true
 *   - 但保留 ownerId/fieldSlot 信息，便于补位完成后 `deployFromHand` 将新卡接手该位置
 *   - 新卡接手后 acted=false, skipped=false，本小轮次可立即行动（不跳过轮次）
 */
export function killUnit(
  state: S7DBattleState,
  instanceId: string,
  reason: string,
  killerId?: string,
): void {
  const u = state.units[instanceId];
  if (!u) {
    console.warn('[s7d-killUnit] 单位不存在', instanceId);
    return;
  }
  if (u.zone === 'grave') {
    console.log('[s7d-killUnit] 已在 grave，跳过', instanceId, u.name);
    return; // 重复调用
  }

  const oldZone = u.zone;
  const oldSlot = u.fieldSlot;
  u.zone = 'grave';
  u.hp = 0;
  u.position = undefined;
  u.fieldSlot = undefined;
  u.deadAtBigRound = state.bigRound;
  u.deadAtSubRound = state.subRound;

  console.log('[s7d-killUnit] 击杀', u.name, 'owner=', u.ownerId, 'oldSlot=', oldSlot, 'reason=', reason);

  appendLog(state, 'death', `${u.name} 阵亡（${reason}）`, {
    actorId: killerId,
    targetIds: [instanceId],
  });

  // 释放战斗区槽位
  if (oldZone === 'field' && oldSlot) {
    const player = getPlayer(state, u.ownerId);
    if (player) {
      if (oldSlot === 1) player.fieldSlots.slot1 = undefined;
      else if (oldSlot === 2) player.fieldSlots.slot2 = undefined;

      // 检查玩家是否还有战斗力
      const hasAlive = player.instanceIds.some((iid) => {
        const unit = state.units[iid];
        return unit && unit.hp > 0 && unit.zone !== 'grave';
      });
      if (!hasAlive) {
        player.alive = false;
        console.log('[s7d-killUnit]', player.heroName, '全队阵亡');
      } else {
        // 发起补位请求：从手牌选 1 张补 oldSlot
        const handIds = getHandUnits(state, u.ownerId).map((h) => h.instanceId);
        if (handIds.length > 0) {
          const task: ReinforceTask = {
            ownerId: u.ownerId,
            slot: oldSlot,
            candidateInstanceIds: handIds,
            reason: `${u.name} 阵亡`,
          };
          state.reinforceQueue.push(task);
          // 推进 phase 到补位态，阻塞其他流程
          state.phase = 'reinforce';
          console.log('[s7d-killUnit] 发起补位', player.heroName, 'slot=', oldSlot, 'candidates=', handIds.length);
          appendLog(
            state,
            'reinforce_request',
            `${player.heroName} 需从手牌补位（卡${oldSlot}空出）`,
            { targetIds: [u.ownerId], payload: { slot: oldSlot } },
          );
        } else {
          console.log('[s7d-killUnit]', player.heroName, '手牌已空，无可补位');
        }
      }
    } else {
      console.warn('[s7d-killUnit] 找不到 player', u.ownerId);
    }
  } else {
    console.log('[s7d-killUnit] 死前不在 field 或无 slot，跳过补位发起', oldZone, oldSlot);
  }

  // 从行动队列中移除（若本回合还未轮到）
  // 保留 ownerId/fieldSlot 以便补位完成后新卡接手
  for (const item of state.actionQueue) {
    if (item.instanceId === instanceId && !item.acted) {
      item.skipped = true;
    }
  }
}

/**
 * 治疗单位（返回实际回复量）
 */
export function healUnit(
  state: S7DBattleState,
  instanceId: string,
  amount: number,
  reason: string,
): number {
  const u = state.units[instanceId];
  if (!u || u.hp <= 0) return 0;
  const actual = Math.min(u.hpMax - u.hp, Math.max(0, amount));
  if (actual <= 0) return 0;
  u.hp += actual;
  appendLog(state, 'heal', `${u.name} 恢复 ${actual} 点气血（${reason}）· 当前 ${u.hp}/${u.hpMax}`, {
    targetIds: [instanceId],
    payload: { amount: actual, reason },
  });
  return actual;
}

// ==========================================================================
// 阵亡补位（从手牌 → 战斗区）
// ==========================================================================

/**
 * 玩家补位：从手牌选 1 张卡放到战斗区指定槽位的指定出生点。
 *
 * @param ownerId 补位玩家
 * @param instanceId 要补位的卡（来自手牌）
 * @param slot 目标槽位（通常是空出的那个）
 * @param to 部署位置（必须是我方出生点且未被占用）
 */
export function deployFromHand(
  state: S7DBattleState,
  ownerId: BattleOwnerId,
  instanceId: string,
  slot: FieldSlot,
  to: GridPos,
): { ok: boolean; reason?: string } {
  const player = getPlayer(state, ownerId);
  if (!player) return { ok: false, reason: 'player_not_found' };

  const unit = state.units[instanceId];
  if (!unit) return { ok: false, reason: 'unit_not_found' };
  if (unit.zone !== 'hand') return { ok: false, reason: 'not_in_hand' };
  if (unit.ownerId !== ownerId) return { ok: false, reason: 'owner_mismatch' };

  // 槽位校验
  const currentSlot = slot === 1 ? player.fieldSlots.slot1 : player.fieldSlots.slot2;
  if (currentSlot) return { ok: false, reason: 'slot_occupied' };

  // 出生点校验
  const validSpawn = player.faction === 'A' ? isSpawnA(to.row, to.col) : isSpawnB(to.row, to.col);
  if (!validSpawn) return { ok: false, reason: 'not_own_spawn' };
  if (isCellOccupied(state, to.row, to.col)) return { ok: false, reason: 'cell_occupied' };

  // 部署
  unit.zone = 'field';
  unit.position = { row: to.row, col: to.col };
  unit.fieldSlot = slot;
  unit.deployedAtRound = state.bigRound;
  // 补位新卡默认重置当前回合行动标记
  unit.attackedThisTurn = false;
  unit.stepsUsedThisTurn = 0;
  unit.hasMovedThisTurn = false;
  unit.hasActedThisTurn = false;
  if (slot === 1) player.fieldSlots.slot1 = instanceId;
  else player.fieldSlots.slot2 = instanceId;

  appendLog(
    state,
    'deploy',
    `${player.heroName} 将 ${unit.name} 部署到战斗区（卡${slot}）· 位置 (${to.row},${to.col})`,
    { actorId: ownerId, targetIds: [instanceId], payload: { slot, to } },
  );

  // ✅ 规则 v2：补位不跳过轮次
  // 扫描 actionQueue：若存在同 owner+slot 且已被 killUnit 标记为 skipped 的项，
  // 则把 instanceId 替换为新卡，取消 skipped，让新卡接手该行动权。
  // 注意：只接手当前或之后的项（currentActorIdx 及以后），已过去的不补。
  for (let i = state.currentActorIdx; i < state.actionQueue.length; i++) {
    const item = state.actionQueue[i];
    if (
      item.ownerId === ownerId &&
      item.fieldSlot === slot &&
      item.skipped &&
      !item.acted
    ) {
      item.instanceId = instanceId;
      item.skipped = false;
      appendLog(
        state,
        'text',
        `↪ ${unit.name} 接手该轮次行动权（补位不跳过轮次）`,
        { targetIds: [instanceId] },
      );
      break;
    }
  }

  // 从 reinforceQueue 中移除已完成的任务
  state.reinforceQueue = state.reinforceQueue.filter(
    (t) => !(t.ownerId === ownerId && t.slot === slot),
  );

  appendLog(state, 'reinforce_done', `${player.heroName} 补位完成`, {
    actorId: ownerId,
    payload: { slot },
  });

  // 若全部补位已完成，phase 恢复为常规行动态
  if (state.reinforceQueue.length === 0 && state.phase === 'reinforce') {
    state.phase = 'sub_round_action';
  }

  return { ok: true };
}

/** 获取某玩家某槽位可用的补位出生点（过滤已占用） */
export function getAvailableSpawnPositions(
  state: S7DBattleState,
  ownerId: BattleOwnerId,
): GridPos[] {
  const player = getPlayer(state, ownerId);
  if (!player) return [];
  const spawns = player.faction === 'A' ? S7D_SPAWN_A : S7D_SPAWN_B;
  const result: GridPos[] = [];
  for (const [r, c] of spawns) {
    if (!isCellOccupied(state, r, c)) {
      result.push({ row: r, col: c });
    }
  }
  return result;
}

// ==========================================================================
// 回合流转
// ==========================================================================

/**
 * 推进当前行动者指针。
 * 若本小轮次所有人都行动完 → 返回 'sub_round_end'
 * 否则返回 'next_actor'
 *
 * ⚠️ 规则 v2：补位期间（phase === 'reinforce'）阻塞推进，返回 'blocked'
 */
export function advanceActor(
  state: S7DBattleState,
): 'next_actor' | 'sub_round_end' | 'blocked' {
  // 补位未完成时不推进
  if (state.phase === 'reinforce' || state.reinforceQueue.length > 0) {
    return 'blocked';
  }

  // 先把当前标记为已行动
  if (state.currentActorIdx < state.actionQueue.length) {
    state.actionQueue[state.currentActorIdx].acted = true;
  }

  // 跳过已阵亡/已 skip 的项
  let nextIdx = state.currentActorIdx + 1;
  while (nextIdx < state.actionQueue.length) {
    const item = state.actionQueue[nextIdx];
    if (!item.skipped && !item.acted) {
      const u = state.units[item.instanceId];
      if (u && u.hp > 0 && u.zone === 'field') break;
    }
    nextIdx += 1;
  }
  state.currentActorIdx = nextIdx;

  if (nextIdx >= state.actionQueue.length) {
    return 'sub_round_end';
  }
  return 'next_actor';
}

/**
 * 推进到下一个小轮次 / 下一大回合。
 * 会自动构造新队列、重置本回合标记、大回合末触发水晶结算。
 *
 * ⚠️ 规则 v2：补位未完成时返回 'blocked'，不推进
 */
export function advanceSubRound(
  state: S7DBattleState,
): 'started' | 'ended' | 'blocked' {
  // 补位未完成时不推进
  if (state.phase === 'reinforce' || state.reinforceQueue.length > 0) {
    return 'blocked';
  }

  if (state.subRound === 1) {
    // 小轮次 1 → 小轮次 2
    appendLog(state, 'sub_round_end', `第 ${state.bigRound} 大回合 · 小轮次 1 结束`);
    state.subRound = 2;
    state.actionQueue = buildActionQueue(state.players, state.units, 2);
    state.currentActorIdx = 0;
    state.phase = 'sub_round_action';
    appendLog(
      state,
      'sub_round_start',
      `第 ${state.bigRound} 大回合 · 小轮次 2 开始（各方卡二行动）`,
    );
    // 小轮次开始时重置本回合标记
    resetTurnFlagsForQueue(state);
    return 'started';
  }

  // 小轮次 2 结束 → 大回合末水晶结算
  appendLog(state, 'sub_round_end', `第 ${state.bigRound} 大回合 · 小轮次 2 结束`);
  resolveCrystalDamage(state);

  // 检查胜负
  const result = checkWinCondition(state);
  if (result) {
    setWinner(state, result.winner, result.reason);
    return 'ended';
  }

  // 进入下一大回合
  appendLog(state, 'round_end', `第 ${state.bigRound} 大回合结束`);
  state.bigRound += 1;

  // 超时检测
  if (state.bigRound > state.bigRoundMax) {
    setWinner(state, 'draw', 'timeout');
    return 'ended';
  }

  state.subRound = 1;
  state.actionQueue = buildActionQueue(state.players, state.units, 1);
  state.currentActorIdx = 0;
  state.phase = 'sub_round_action';
  appendLog(
    state,
    'round_start',
    `第 ${state.bigRound} 大回合开始 · 小轮次 1（各方卡一行动）`,
  );
  resetTurnFlagsForQueue(state);
  return 'started';
}

/**
 * 为**所有场上单位**重置本回合行动标记
 *
 * ⚠️ 注意：原本只重置 actionQueue 中的单位（即当前小轮次即将行动的卡），
 * 但这会遗漏场上的"另一张"卡（它不在当前 slot 队列里）。
 * 小轮次切换时，**场上所有活着的 field 单位**都应重置本回合临时标记，
 * 否则会残留 hasActedThisTurn / stepsUsedThisTurn / attackedThisTurn 等。
 */
function resetTurnFlagsForQueue(state: S7DBattleState): void {
  for (const unit of Object.values(state.units)) {
    if (unit.zone !== 'field' || unit.hp <= 0) continue;
    unit.hasActedThisTurn = false;
    unit.hasMovedThisTurn = false;
    unit.attackedThisTurn = false;
    unit.stepsUsedThisTurn = 0;
    unit.skillUsedThisTurn = false;
  }
}

// ==========================================================================
// 技能（Batch 2A · 简化版）
// ==========================================================================

/**
 * 简化版"使用战技"：本阶段不走引擎 hook，仅写战报 + 标记已用。
 * Batch 2B 将接入 SkillRegistry.run() 的真实效果执行。
 *
 * @returns 是否成功发起
 */
export function useBattleSkillSimple(
  state: S7DBattleState,
  casterId: string,
  targetIds: string[],
): boolean {
  const u = state.units[casterId];
  if (!u || u.zone !== 'field' || u.hp <= 0) return false;
  if (!u.battleSkill) return false;
  if (u.skillUsedThisTurn) return false;
  if (u.attackedThisTurn) return false;

  u.skillUsedThisTurn = true;

  const targets = targetIds.map((tid) => state.units[tid]?.name).filter(Boolean).join('、');
  const targetDesc = targets ? ` → ${targets}` : '';
  appendLog(
    state,
    'skill_cast',
    `✨ ${u.name} 使用战技【${u.battleSkill.name}】${targetDesc}（效果待 Batch 2B 接入引擎）`,
    { actorId: casterId, targetIds, payload: { skillType: 'battle', skillName: u.battleSkill.name } },
  );
  return true;
}

/**
 * 简化版"使用绝技"：本阶段不走引擎 hook，仅写战报 + 标记 ultimateUsed。
 * Batch 2B 将接入 SkillRegistry.run() 的真实效果执行。
 *
 * @returns 是否成功发起
 */
export function useUltimateSimple(
  state: S7DBattleState,
  casterId: string,
  targetIds: string[],
): boolean {
  const u = state.units[casterId];
  if (!u || u.zone !== 'field' || u.hp <= 0) return false;
  if (!u.ultimate) return false;
  if (u.ultimateUsed) return false;
  if (u.skillUsedThisTurn) return false;
  if (u.attackedThisTurn) return false;

  u.ultimateUsed = true;
  u.skillUsedThisTurn = true;

  const targets = targetIds.map((tid) => state.units[tid]?.name).filter(Boolean).join('、');
  const targetDesc = targets ? ` → ${targets}` : '';
  appendLog(
    state,
    'skill_cast',
    `⚡ ${u.name} 释放绝技【${u.ultimate.name}】${targetDesc}（效果待 Batch 2B 接入引擎）`,
    { actorId: casterId, targetIds, payload: { skillType: 'ultimate', skillName: u.ultimate.name } },
  );
  return true;
}

// ==========================================================================
// 水晶结算（大回合末）
// ==========================================================================

export function resolveCrystalDamage(state: S7DBattleState): void {
  const { onCrystalA, onCrystalB } = getCrystalOccupants(state);

  if (onCrystalA.length > 0) {
    const dmg = onCrystalA.length;
    state.crystalA.hp = Math.max(0, state.crystalA.hp - dmg);
    state.crystalA.damageLog.push({
      bigRound: state.bigRound,
      occupants: onCrystalA.map((u) => ({
        instanceId: u.instanceId,
        ownerId: u.ownerId,
        pos: u.position!,
      })),
      damage: dmg,
    });
    const names = onCrystalA.map((u) => u.name).join('、');
    appendLog(
      state,
      'crystal_damage',
      `A 方水晶被占领！${names} 合计造成 ${dmg} 点损伤 · 剩余 ${state.crystalA.hp}/${state.crystalA.hpMax}`,
      { payload: { faction: 'A', dmg, occupants: onCrystalA.map((u) => u.instanceId) } },
    );
    if (state.crystalA.hp <= 0) {
      appendLog(state, 'crystal_broken', `💥 A 方水晶被击碎！`, { payload: { faction: 'A' } });
    }
  }

  if (onCrystalB.length > 0) {
    const dmg = onCrystalB.length;
    state.crystalB.hp = Math.max(0, state.crystalB.hp - dmg);
    state.crystalB.damageLog.push({
      bigRound: state.bigRound,
      occupants: onCrystalB.map((u) => ({
        instanceId: u.instanceId,
        ownerId: u.ownerId,
        pos: u.position!,
      })),
      damage: dmg,
    });
    const names = onCrystalB.map((u) => u.name).join('、');
    appendLog(
      state,
      'crystal_damage',
      `B 方水晶被占领！${names} 合计造成 ${dmg} 点损伤 · 剩余 ${state.crystalB.hp}/${state.crystalB.hpMax}`,
      { payload: { faction: 'B', dmg, occupants: onCrystalB.map((u) => u.instanceId) } },
    );
    if (state.crystalB.hp <= 0) {
      appendLog(state, 'crystal_broken', `💥 B 方水晶被击碎！`, { payload: { faction: 'B' } });
    }
  }
}

// ==========================================================================
// 胜负
// ==========================================================================

export function setWinner(
  state: S7DBattleState,
  winner: BattleFaction | 'draw',
  reason: 'crystal_broken' | 'all_dead' | 'timeout',
): void {
  state.winner = winner;
  state.endReason = reason;
  state.phase = 'ended';
  const reasonText =
    reason === 'crystal_broken' ? '水晶破碎' : reason === 'all_dead' ? '全员阵亡' : '40 大回合超时';
  if (winner === 'draw') {
    appendLog(state, 'battle_timeout', `战斗结束：平局（${reasonText}）`);
  } else if (winner === state.playerFaction) {
    appendLog(state, 'battle_victory', `战斗结束：我方（${winner} 方）胜利！（${reasonText}）`);
  } else {
    appendLog(state, 'battle_defeat', `战斗结束：我方（${state.playerFaction} 方）失败（${reasonText}）`);
  }
}
