/**
 * S7D · 战场查询工具（纯函数，不改状态）
 *
 * 提供：
 *   - 地图占位查询（某格站了谁）
 *   - 可达范围计算（某单位能走到哪）
 *   - 三区成员筛选（某玩家的战斗区/手牌区/弃牌区）
 *   - 水晶状态查询（某回合站在敌晶上的棋子）
 *   - 胜负判定
 */

import type {
  BattleCardInstance,
  BattleFaction,
  BattleOwnerId,
  BattlePlayer,
  GridPos,
  S7DBattleState,
} from '@/types/s7dBattle';
import {
  S7D_MAP_COLS,
  S7D_MAP_ROWS,
  isWalkable,
} from '@/data/s7dMap';

// ==========================================================================
// 基础查询
// ==========================================================================

/** 根据 instanceId 取卡实例（不存在返回 undefined） */
export function getUnit(state: S7DBattleState, instanceId: string): BattleCardInstance | undefined {
  return state.units[instanceId];
}

/** 获取某玩家 */
export function getPlayer(state: S7DBattleState, ownerId: BattleOwnerId): BattlePlayer | undefined {
  return state.players.find((p) => p.ownerId === ownerId);
}

/** 获取某玩家的所有卡（6 张） */
export function getPlayerUnits(state: S7DBattleState, ownerId: BattleOwnerId): BattleCardInstance[] {
  const player = getPlayer(state, ownerId);
  if (!player) return [];
  return player.instanceIds
    .map((iid) => state.units[iid])
    .filter((u): u is BattleCardInstance => !!u);
}

/** 获取某玩家战斗区的卡（按 slot1/slot2 顺序） */
export function getFieldUnits(state: S7DBattleState, ownerId: BattleOwnerId): BattleCardInstance[] {
  const player = getPlayer(state, ownerId);
  if (!player) return [];
  const result: BattleCardInstance[] = [];
  const s1 = player.fieldSlots.slot1 ? state.units[player.fieldSlots.slot1] : undefined;
  const s2 = player.fieldSlots.slot2 ? state.units[player.fieldSlots.slot2] : undefined;
  if (s1 && s1.zone === 'field') result.push(s1);
  if (s2 && s2.zone === 'field') result.push(s2);
  return result;
}

/** 获取某玩家手牌区的卡 */
export function getHandUnits(state: S7DBattleState, ownerId: BattleOwnerId): BattleCardInstance[] {
  return getPlayerUnits(state, ownerId).filter((u) => u.zone === 'hand');
}

/** 获取某玩家弃牌区的卡 */
export function getGraveUnits(state: S7DBattleState, ownerId: BattleOwnerId): BattleCardInstance[] {
  return getPlayerUnits(state, ownerId).filter((u) => u.zone === 'grave');
}

// ==========================================================================
// 阵营查询
// ==========================================================================

/** 获取某阵营所有存活的战斗区卡 */
export function getFactionFieldUnits(
  state: S7DBattleState,
  faction: BattleFaction,
): BattleCardInstance[] {
  return Object.values(state.units).filter(
    (u) => u.faction === faction && u.zone === 'field' && u.hp > 0,
  );
}

/** 获取某阵营所有玩家 */
export function getFactionPlayers(state: S7DBattleState, faction: BattleFaction): BattlePlayer[] {
  return state.players.filter((p) => p.faction === faction);
}

/** 判断某阵营是否全灭（18 张卡全阵亡） */
export function isFactionAllDead(state: S7DBattleState, faction: BattleFaction): boolean {
  const units = Object.values(state.units).filter((u) => u.faction === faction);
  if (units.length === 0) return false;
  return units.every((u) => u.hp <= 0 || u.zone === 'grave');
}

// ==========================================================================
// 地图占位
// ==========================================================================

/** 查询某格站的是谁（没人返回 null） */
export function getUnitAt(state: S7DBattleState, row: number, col: number): BattleCardInstance | null {
  for (const u of Object.values(state.units)) {
    if (u.zone !== 'field') continue;
    if (u.hp <= 0) continue;
    if (u.position && u.position.row === row && u.position.col === col) return u;
  }
  return null;
}

/** 某格是否被占用 */
export function isCellOccupied(state: S7DBattleState, row: number, col: number): boolean {
  return getUnitAt(state, row, col) !== null;
}

/** 构建占位 map（key = "r,c" → instanceId），用于批量查询优化 */
export function buildOccupancyMap(state: S7DBattleState): Map<string, string> {
  const map = new Map<string, string>();
  for (const u of Object.values(state.units)) {
    if (u.zone !== 'field' || u.hp <= 0 || !u.position) continue;
    map.set(`${u.position.row},${u.position.col}`, u.instanceId);
  }
  return map;
}

// ==========================================================================
// 可达范围（BFS，基于心境步数上限）
// ==========================================================================

/**
 * 计算某单位的可达格子（曼哈顿距离 + 路径连通）
 *
 * 规则（与 S7A/S7B/S7C 一致）：
 *   - 步数上限 = u.mnd - u.stepsUsedThisTurn（每移动 1 格消耗 1 心境值）
 *   - 只能上下左右四方向移动
 *   - 障碍物/河（非桥）阻挡通行
 *   - **任何存活的其他单位（含友方与敌方）都视为障碍物，不能跨越**
 *   - 不能停在已被占用的格子上
 */
export function getReachableCells(
  state: S7DBattleState,
  instanceId: string,
): GridPos[] {
  const u = state.units[instanceId];
  if (!u || u.zone !== 'field' || u.hp <= 0 || !u.position) return [];
  if (u.immobilized) return [];

  const maxSteps = Math.max(0, u.mnd - u.stepsUsedThisTurn);
  if (maxSteps === 0) return [];

  const occ = buildOccupancyMap(state);
  const dynObs = new Set(state.dynamicObstacles ?? []);
  const visited = new Map<string, number>(); // "r,c" → 步数
  const start = u.position;
  const startKey = `${start.row},${start.col}`;
  visited.set(startKey, 0);

  // BFS（仅四方向）
  const queue: Array<{ row: number; col: number; steps: number }> = [
    { row: start.row, col: start.col, steps: 0 },
  ];

  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur.steps >= maxSteps) continue;

    const dirs = [
      { dr: -1, dc: 0 },
      { dr: 1, dc: 0 },
      { dr: 0, dc: -1 },
      { dr: 0, dc: 1 },
    ];
    for (const { dr, dc } of dirs) {
      const nr = cur.row + dr;
      const nc = cur.col + dc;
      const key = `${nr},${nc}`;
      if (nr < 0 || nr >= S7D_MAP_ROWS || nc < 0 || nc >= S7D_MAP_COLS) continue;
      if (!isWalkable(nr, nc)) continue;
      // 动态障碍（萧战祖树盾等）一律不可通过
      if (dynObs.has(key)) continue;
      // 任意存活单位都阻挡通行（含友方/敌方），与 S7A/S7B/S7C 一致
      // 自己所在的起点格因 visited 已记录，不会走回头路
      const occupantId = occ.get(key);
      if (occupantId && occupantId !== u.instanceId) continue;
      const prev = visited.get(key);
      if (prev !== undefined && prev <= cur.steps + 1) continue;
      visited.set(key, cur.steps + 1);
      queue.push({ row: nr, col: nc, steps: cur.steps + 1 });
    }
  }

  // 收集终点（排除起点 + 有任何单位的格子）
  const cells: GridPos[] = [];
  for (const [key, steps] of visited.entries()) {
    if (steps === 0) continue;
    const [r, c] = key.split(',').map(Number);
    const occupantId = occ.get(key);
    if (occupantId) continue; // 不能停在有人的格上
    cells.push({ row: r, col: c });
  }
  return cells;
}

// ==========================================================================
// 水晶查询
// ==========================================================================

/**
 * 获取大回合结束时应被占领水晶的棋子列表（按阵营分组）。
 * 用于 round_end 结算。
 */
export function getCrystalOccupants(state: S7DBattleState): {
  onCrystalA: BattleCardInstance[]; // 站在 A 方水晶上的 B 方单位（B 方占领，A 方扣血）
  onCrystalB: BattleCardInstance[]; // 站在 B 方水晶上的 A 方单位（A 方占领，B 方扣血）
} {
  const aKeys = new Set(state.crystalA.positions.map((p) => `${p.row},${p.col}`));
  const bKeys = new Set(state.crystalB.positions.map((p) => `${p.row},${p.col}`));

  const onCrystalA: BattleCardInstance[] = [];
  const onCrystalB: BattleCardInstance[] = [];

  for (const u of Object.values(state.units)) {
    if (u.zone !== 'field' || u.hp <= 0 || !u.position) continue;
    const key = `${u.position.row},${u.position.col}`;
    if (aKeys.has(key) && u.faction === 'B') {
      onCrystalA.push(u);
    }
    if (bKeys.has(key) && u.faction === 'A') {
      onCrystalB.push(u);
    }
  }
  return { onCrystalA, onCrystalB };
}

// ==========================================================================
// 胜负判定
// ==========================================================================

/** 返回当前战场胜负结果（null 表示还在打） */
export function checkWinCondition(
  state: S7DBattleState,
): { winner: BattleFaction | 'draw'; reason: 'crystal_broken' | 'all_dead' | 'timeout' } | null {
  // 水晶破碎
  if (state.crystalA.hp <= 0 && state.crystalB.hp <= 0) {
    return { winner: 'draw', reason: 'crystal_broken' };
  }
  if (state.crystalA.hp <= 0) {
    return { winner: 'B', reason: 'crystal_broken' };
  }
  if (state.crystalB.hp <= 0) {
    return { winner: 'A', reason: 'crystal_broken' };
  }
  // 全灭
  const aAllDead = isFactionAllDead(state, 'A');
  const bAllDead = isFactionAllDead(state, 'B');
  if (aAllDead && bAllDead) return { winner: 'draw', reason: 'all_dead' };
  if (aAllDead) return { winner: 'B', reason: 'all_dead' };
  if (bAllDead) return { winner: 'A', reason: 'all_dead' };
  // 超时
  if (state.bigRound > state.bigRoundMax) {
    return { winner: 'draw', reason: 'timeout' };
  }
  return null;
}

// ==========================================================================
// 当前行动者
// ==========================================================================

/** 获取当前正在行动的队列项（可能为 undefined） */
export function getCurrentAction(state: S7DBattleState) {
  return state.actionQueue[state.currentActorIdx];
}

/** 获取当前正在行动的单位 */
export function getCurrentActor(state: S7DBattleState): BattleCardInstance | undefined {
  const action = getCurrentAction(state);
  if (!action) return undefined;
  return state.units[action.instanceId];
}
