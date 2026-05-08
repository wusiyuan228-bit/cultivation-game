/**
 * S7 战斗系统 Store — 合作清怪战
 * 4×10地图，2v6，8回合限制
 */
import { create } from 'zustand';
import { asset } from '@/utils/assetPath';
import type { CultivationType } from '@/types/game';

/* ============ 类型定义 ============ */

export interface BattleUnit {
  id: string;
  name: string;
  type: CultivationType;
  hp: number;
  maxHp: number;
  atk: number;
  mnd: number;
  isEnemy: boolean;
  row: number;
  col: number;
  /** 战斗技能 */
  battleSkill: { name: string; desc: string } | null;
  /** 绝技（每场1次） */
  ultimate: { name: string; desc: string } | null;
  /** 绝技是否已使用 */
  ultimateUsed: boolean;
  /** 本回合是否已行动 */
  acted: boolean;
  /** 本回合已移动步数（上限 = mnd） */
  stepsUsedThisTurn: number;
  /** 本回合是否已执行普通攻击（执行后自动结束回合） */
  attackedThisTurn: boolean;
  /** 控制状态：无法移动 */
  immobilized: boolean;
  /** 控制状态：无法行动 */
  stunned: boolean;
  /** 是否已退场 */
  dead: boolean;
  /** 立绘图片路径 */
  portrait: string;
  /** 上回合结束时停留的地形（用于下回合结算增益） */
  lastTerrain: TerrainType | null;
}

export type TerrainType = 'normal' | 'obstacle' | 'spring' | 'atk_boost' | 'mnd_boost' | 'miasma';

export interface MapCell {
  row: number;
  col: number;
  terrain: TerrainType;
}

export type ActionPhase = 'idle' | 'select_unit' | 'skill_or_move' | 'moving' | 'select_attack' | 'rolling_dice' | 'result' | 'enemy_turn' | 'round_end' | 'battle_end';

export interface DiceResult {
  attackerDice: number[];
  defenderDice: number[];
  attackerSum: number;
  defenderSum: number;
  skillMod: number;
  counterMod: number;
  damage: number;
}

export interface BattleLog {
  round: number;
  text: string;
  type: 'action' | 'damage' | 'skill' | 'system' | 'kill';
}

/** 克制关系：剑→妖→体→灵→法→剑，丹修中立 */
const COUNTER_MAP: Record<string, string> = {
  剑修: '妖修',
  妖修: '体修',
  体修: '灵修',
  灵修: '法修',
  法修: '剑修',
};

export function isCounter(attackerType: CultivationType, defenderType: CultivationType): boolean {
  return COUNTER_MAP[attackerType] === defenderType;
}

/** 投二面骰（0/1/2） */
function rollDice(count: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < Math.max(1, count); i++) {
    result.push(Math.floor(Math.random() * 3)); // 0, 1, 2
  }
  return result;
}

function sum(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0);
}

/** 曼哈顿距离 */
function manhattan(r1: number, c1: number, r2: number, c2: number): number {
  return Math.abs(r1 - r2) + Math.abs(c1 - c2);
}

/* ============ 默认地图 4×10 — 教学合作清怪 ============ */
/*
     0     1     2     3     4     5     6     7     8     9
   ┌─────┬─────┬─────┬─────┬─────┬─────┬─────┬─────┬─────┬─────┐
 0 │ 🟢  │  ·  │  ·  │ 🟡  │ ⬛  │  ·  │ 🔴  │ 🔴  │  ·  │ 🔴  │
   │玩家A│     │     │修为+1│障碍 │     │敌0  │敌1  │     │敌2  │
   ├─────┼─────┼─────┼─────┼─────┼─────┼─────┼─────┼─────┼─────┤
 1 │ 🟢  │  ·  │ 💧  │  ·  │  ·  │ ☠️  │  ·  │ 🔴  │  ·  │  ·  │
   │玩家B│     │气血+1│     │     │瘴气 │     │敌3  │     │     │
   ├─────┼─────┼─────┼─────┼─────┼─────┼─────┼─────┼─────┼─────┤
 2 │  ·  │ 🔵  │  ·  │  ·  │  ·  │ ⬛  │  ·  │  ·  │ 🔴  │  ·  │
   │     │心境+1│     │     │     │障碍 │     │     │敌4  │     │
   ├─────┼─────┼─────┼─────┼─────┼─────┼─────┼─────┼─────┼─────┤
 3 │  ·  │  ·  │  ·  │ 💧  │ ☠️  │  ·  │ 🟡  │ 🔴  │  ·  │  ·  │
   │     │     │     │气血+1│瘴气 │     │修为+1│敌5  │     │     │
   └─────┴─────┴─────┴─────┴─────┴─────┴─────┴─────┴─────┴─────┘

地形统计(40格)：
- 普通格: 27 (67.5%)  - 增益格: 5 (12.5%) — 修为×2 + 气血×2 + 心境×1
- 减益格: 2 (5%)      - 障碍: 2 (5%)      - 出发/敌位: 8
*/

function createDefaultMap(): MapCell[][] {
  const map: MapCell[][] = [];
  for (let r = 0; r < 4; r++) {
    const row: MapCell[] = [];
    for (let c = 0; c < 10; c++) {
      row.push({ row: r, col: c, terrain: 'normal' });
    }
    map.push(row);
  }
  // 修为增长格（金色 ⚔）
  map[0][3] = { row: 0, col: 3, terrain: 'atk_boost' };
  map[3][6] = { row: 3, col: 6, terrain: 'atk_boost' };
  // 心境增长格（青色 🧘）
  map[2][1] = { row: 2, col: 1, terrain: 'mnd_boost' };
  // 气血恢复格（蓝色 💧）
  map[1][2] = { row: 1, col: 2, terrain: 'spring' };
  map[3][3] = { row: 3, col: 3, terrain: 'spring' };
  // 瘴气伤害格（紫红 ☠）
  map[1][5] = { row: 1, col: 5, terrain: 'miasma' };
  map[3][4] = { row: 3, col: 4, terrain: 'miasma' };
  // 障碍（黑色 ⬛）
  map[0][4] = { row: 0, col: 4, terrain: 'obstacle' };
  map[2][5] = { row: 2, col: 5, terrain: 'obstacle' };
  return map;
}

/** 6个敌人的默认位置和修士类型 */
const ENEMY_DEFS: Array<{ row: number; col: number; type: CultivationType; name: string }> = [
  { row: 0, col: 6, type: '剑修', name: '剑修劫匪' },
  { row: 0, col: 7, type: '法修', name: '法修劫匪' },
  { row: 0, col: 9, type: '体修', name: '体修劫匪' },
  { row: 1, col: 7, type: '灵修', name: '灵修劫匪' },
  { row: 2, col: 8, type: '妖修', name: '妖修劫匪' },
  { row: 3, col: 7, type: '丹修', name: '丹修劫匪' },
];

/* ============ Store ============ */

interface BattleState {
  /** 是否已初始化 */
  initialized: boolean;
  /** 地图 */
  map: MapCell[][];
  /** 所有单位 */
  units: BattleUnit[];
  /** 当前回合数 */
  round: number;
  /** 最大回合 */
  maxRound: number;
  /** 当前选中的单位id */
  selectedUnitId: string | null;
  /** 行动阶段 */
  phase: ActionPhase;
  /** 高亮可走的格子 */
  moveRange: Array<{ row: number; col: number }>;
  /** 高亮可攻击的格子 */
  attackRange: Array<{ row: number; col: number }>;
  /** 最近一次骰子结果 */
  lastDice: DiceResult | null;
  /** 击杀数 */
  killCount: number;
  /** 战报 */
  logs: BattleLog[];
  /** 本回合是否已使用技能 */
  skillUsedThisTurn: boolean;
  /** 战斗结束 */
  battleOver: boolean;
  /** 战斗结果 */
  battleResult: 'win' | 'lose' | 'timeout' | null;
  /** 当前正在行动的角色索引（用于轮流行动） */
  actionQueue: string[];
  /** 当前行动角色在队列中的索引 */
  actionIndex: number;

  // === 方法 ===
  initBattle: (heroUnit: Omit<BattleUnit, 'acted' | 'dead' | 'ultimateUsed' | 'immobilized' | 'stunned' | 'lastTerrain' | 'stepsUsedThisTurn' | 'attackedThisTurn'>, partnerUnit: Omit<BattleUnit, 'acted' | 'dead' | 'ultimateUsed' | 'immobilized' | 'stunned' | 'lastTerrain' | 'stepsUsedThisTurn' | 'attackedThisTurn'>) => void;
  selectUnit: (unitId: string) => void;
  cancelSelect: () => void;
  /** 计算可移动范围 */
  calcMoveRange: (unitId: string) => void;
  /** 移动 */
  moveUnit: (unitId: string, toRow: number, toCol: number) => void;
  /** 计算可攻击范围 */
  calcAttackRange: (unitId: string) => void;
  /** 执行普攻 */
  attack: (attackerId: string, defenderId: string, skillMod?: number) => DiceResult;
  /** 使用技能 */
  useSkill: (unitId: string, skillType: 'battle' | 'ultimate') => void;
  /** 结束当前单位回合 */
  endUnitTurn: (unitId: string) => void;
  /** 推进到下一个行动单位 */
  advanceAction: () => void;
  /** 新回合开始 */
  startNewRound: () => void;
  /** AI敌人反击 */
  enemyCounterAttack: (enemyId: string) => DiceResult | null;
  /** AI回合 */
  processEnemyRound: () => void;
  /** 添加日志 */
  addLog: (text: string, type: BattleLog['type']) => void;
  /** 检查战斗结束 */
  checkBattleEnd: () => boolean;
  /** 获取奖励 */
  getRewards: () => { stones: number; clues: number };
  /** 重置 */
  reset: () => void;
  /** 获取当前行动者ID（按心境顺序，跳过已行动或死亡的） */
  getCurrentActorId: () => string | null;
  /** 按路径移动单位（逐格动画），调用方需每格间隔 0.2s */
  moveUnitStep: (unitId: string, toRow: number, toCol: number) => void;
}

const initialState = {
  initialized: false,
  map: [] as MapCell[][],
  units: [] as BattleUnit[],
  round: 1,
  maxRound: 8,
  selectedUnitId: null as string | null,
  phase: 'idle' as ActionPhase,
  moveRange: [] as Array<{ row: number; col: number }>,
  attackRange: [] as Array<{ row: number; col: number }>,
  lastDice: null as DiceResult | null,
  killCount: 0,
  logs: [] as BattleLog[],
  skillUsedThisTurn: false,
  battleOver: false,
  battleResult: null as 'win' | 'lose' | 'timeout' | null,
  actionQueue: [] as string[],
  actionIndex: 0,
};

export const useBattleStore = create<BattleState>((set, get) => ({
  ...initialState,

  initBattle: (heroUnit, partnerUnit) => {
    const map = createDefaultMap();

    const playerUnits: BattleUnit[] = [
      { ...heroUnit, row: 0, col: 0, acted: false, dead: false, ultimateUsed: false, immobilized: false, stunned: false, lastTerrain: null, stepsUsedThisTurn: 0, attackedThisTurn: false },
      { ...partnerUnit, row: 1, col: 0, acted: false, dead: false, ultimateUsed: false, immobilized: false, stunned: false, lastTerrain: null, stepsUsedThisTurn: 0, attackedThisTurn: false },
    ];

    const enemyUnits: BattleUnit[] = ENEMY_DEFS.map((def, i) => ({
      id: `enemy_${i}`,
      name: def.name,
      type: def.type,
      hp: 3,
      maxHp: 3,
      atk: 3,
      mnd: 2,
      isEnemy: true,
      row: def.row,
      col: def.col,
      battleSkill: null,
      ultimate: null,
      ultimateUsed: false,
      acted: false,
      dead: false,
      immobilized: true,  // 劫匪不可移动
      stunned: false,
      portrait: asset('images/map/tile_enemy.png'),
      lastTerrain: null,
      stepsUsedThisTurn: 0,
      attackedThisTurn: false,
    }));

    const allUnits = [...playerUnits, ...enemyUnits];

    // 行动顺序：玩家方按心境值降序（高心境先手），心境相同者按加入顺序
    const playerQueue = [...playerUnits]
      .sort((a, b) => b.mnd - a.mnd)
      .map((u) => u.id);

    set({
      initialized: true,
      map,
      units: allUnits,
      round: 1,
      selectedUnitId: null,
      phase: 'select_unit',
      moveRange: [],
      attackRange: [],
      lastDice: null,
      killCount: 0,
      logs: [{ round: 1, text: '宗门追回物资任务开始！限8回合，尽力击败劫匪带回所有物资！', type: 'system' }],
      skillUsedThisTurn: false,
      battleOver: false,
      battleResult: null,
      actionQueue: playerQueue,
      actionIndex: 0,
    });
  },

  selectUnit: (unitId) => {
    const { units, phase } = get();
    if (phase !== 'select_unit') return;
    const unit = units.find((u) => u.id === unitId);
    if (!unit || unit.dead || unit.acted || unit.isEnemy) return;
    set({ selectedUnitId: unitId, phase: 'skill_or_move' });
    get().calcMoveRange(unitId);
    get().calcAttackRange(unitId);
  },

  cancelSelect: () => {
    set({ selectedUnitId: null, phase: 'select_unit', moveRange: [], attackRange: [] });
  },

  calcMoveRange: (unitId) => {
    const { units, map } = get();
    const unit = units.find((u) => u.id === unitId);
    if (!unit || unit.immobilized) { set({ moveRange: [] }); return; }

    // BFS寻路：只能上下左右移动，障碍物和其他角色占位不可通行
    // 关键：步数预算 = 总步数(mnd) - 本回合已使用步数
    const remainingSteps = Math.max(0, unit.mnd - unit.stepsUsedThisTurn);
    if (remainingSteps <= 0) { set({ moveRange: [] }); return; }

    const range: Array<{ row: number; col: number }> = [];
    const visited = new Set<string>();
    const queue: Array<{ row: number; col: number; steps: number }> = [];
    const key = (r: number, c: number) => `${r},${c}`;

    // 四方向：上下左右
    const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

    visited.add(key(unit.row, unit.col));
    queue.push({ row: unit.row, col: unit.col, steps: 0 });

    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (cur.steps >= remainingSteps) continue;

      for (const [dr, dc] of DIRS) {
        const nr = cur.row + dr;
        const nc = cur.col + dc;
        if (nr < 0 || nr >= 4 || nc < 0 || nc >= 10) continue;
        const k = key(nr, nc);
        if (visited.has(k)) continue;
        visited.add(k);

        // 障碍物不可通行
        if (map[nr][nc].terrain === 'obstacle') continue;
        // 其他存活单位占位不可通行（自己所在格也排除）
        if (units.some((u) => !u.dead && u.id !== unit.id && u.row === nr && u.col === nc)) continue;

        range.push({ row: nr, col: nc });
        queue.push({ row: nr, col: nc, steps: cur.steps + 1 });
      }
    }

    set({ moveRange: range });
  },

  moveUnit: (unitId, toRow, toCol) => {
    const { units, map } = get();
    const idx = units.findIndex((u) => u.id === unitId);
    if (idx === -1) return;
    const prev = units[idx];
    const stepCost = manhattan(prev.row, prev.col, toRow, toCol);
    const updated = [...units];
    updated[idx] = {
      ...prev,
      row: toRow,
      col: toCol,
      stepsUsedThisTurn: prev.stepsUsedThisTurn + stepCost,
    };

    const terrain = map[toRow][toCol].terrain;
    const u = updated[idx];

    // 瘴气伤害格：踏入即生效，各属性-1（下限0/1）
    if (terrain === 'miasma') {
      updated[idx] = {
        ...u,
        atk: Math.max(1, u.atk - 1),
        mnd: Math.max(1, u.mnd - 1),
        hp: Math.max(0, u.hp - 1),
        dead: u.hp - 1 <= 0,
      };
      get().addLog(`☠ ${u.name} 踏入魔气侵蚀区，各属性-1！`, 'damage');
      if (u.hp - 1 <= 0) {
        get().addLog(`💀 ${u.name} 因瘴气而倒下！`, 'kill');
      }
    }

    // 增益地形（修为/心境/气血）不立即生效，需要"停留到下回合行动时"才结算
    // 这里不做处理，会在 startNewRound 时统一结算

    set({ units: updated, moveRange: [] });
    get().calcAttackRange(unitId);
  },

  calcAttackRange: (unitId) => {
    const { units } = get();
    const unit = units.find((u) => u.id === unitId);
    if (!unit) { set({ attackRange: [] }); return; }
    const range: Array<{ row: number; col: number }> = [];
    for (const target of units) {
      if (target.dead || target.isEnemy === unit.isEnemy) continue;
      if (manhattan(unit.row, unit.col, target.row, target.col) === 1) {
        range.push({ row: target.row, col: target.col });
      }
    }
    set({ attackRange: range });
  },

  attack: (attackerId, defenderId, skillMod = 0) => {
    const { units, round } = get();
    const aIdx = units.findIndex((u) => u.id === attackerId);
    const dIdx = units.findIndex((u) => u.id === defenderId);
    if (aIdx === -1 || dIdx === -1) return { attackerDice: [], defenderDice: [], attackerSum: 0, defenderSum: 0, skillMod: 0, counterMod: 0, damage: 0 };

    const attacker = units[aIdx];
    const defender = units[dIdx];

    const aDice = rollDice(attacker.atk);
    const dDice = rollDice(defender.atk);
    const aSum = sum(aDice);
    const dSum = sum(dDice);
    const counterMod = isCounter(attacker.type, defender.type) ? 1 : 0;
    const damage = Math.max(1, aSum - dSum + skillMod + counterMod);

    const updated = [...units];
    const newHp = Math.max(0, defender.hp - damage);
    updated[dIdx] = { ...defender, hp: newHp, dead: newHp <= 0 };

    let killed = false;
    if (newHp <= 0) {
      killed = true;
      if (defender.isEnemy) {
        set((s) => ({ killCount: s.killCount + 1 }));
      }
    }

    const result: DiceResult = { attackerDice: aDice, defenderDice: dDice, attackerSum: aSum, defenderSum: dSum, skillMod, counterMod, damage };

    set({ units: updated, lastDice: result });

    const counterText = counterMod ? ' [克制+1]' : '';
    const skillText = skillMod ? ` [技能+${skillMod}]` : '';
    get().addLog(`${attacker.name} 攻击 ${defender.name}：${aSum}(${aDice.join('+')}) vs ${dSum}(${dDice.join('+')})${skillText}${counterText} → ${damage}点伤害`, 'damage');
    if (killed) {
      get().addLog(`💀 ${defender.name} 被击杀！`, 'kill');
    }

    return result;
  },

  useSkill: (unitId, skillType) => {
    const { units } = get();
    const idx = units.findIndex((u) => u.id === unitId);
    if (idx === -1) return;
    const unit = units[idx];

    if (skillType === 'ultimate') {
      if (unit.ultimateUsed || !unit.ultimate) return;
      const updated = [...units];
      updated[idx] = { ...unit, ultimateUsed: true };
      set({ units: updated, skillUsedThisTurn: true });
      get().addLog(`⚡ ${unit.name} 释放绝技【${unit.ultimate.name}】！`, 'skill');
    } else {
      if (!unit.battleSkill) return;
      set({ skillUsedThisTurn: true });
      get().addLog(`✨ ${unit.name} 使用技能【${unit.battleSkill.name}】`, 'skill');
    }
  },

  endUnitTurn: (unitId) => {
    const { units, map } = get();
    const idx = units.findIndex((u) => u.id === unitId);
    if (idx === -1) return;
    const u = units[idx];
    const terrain = map[u.row]?.[u.col]?.terrain ?? null;
    const updated = [...units];
    updated[idx] = {
      ...updated[idx],
      acted: true,
      lastTerrain: terrain,
      stepsUsedThisTurn: 0,
      attackedThisTurn: false,
    };
    set({ units: updated, selectedUnitId: null, phase: 'select_unit', moveRange: [], attackRange: [], skillUsedThisTurn: false });
  },

  advanceAction: () => {
    const state = get();
    if (state.battleOver) return;

    // 检查本回合是否所有玩家角色都已行动
    const playerUnits = state.units.filter((u) => !u.isEnemy && !u.dead);
    const allActed = playerUnits.every((u) => u.acted);

    if (allActed) {
      // A方案：劫匪完全静止，不反击，直接跳过敌方阶段

      // 检查战斗结束
      if (get().checkBattleEnd()) return;

      // 开始新回合
      get().startNewRound();
    }
  },

  startNewRound: () => {
    const { round, maxRound, units, map } = get();
    const newRound = round + 1;
    if (newRound > maxRound) {
      set({ battleOver: true, battleResult: 'timeout', phase: 'battle_end' });
      get().addLog(`⏰ 第${maxRound}回合结束！战斗结束`, 'system');
      return;
    }

    get().addLog(`── 第 ${newRound} 回合开始 ──`, 'system');

    // ① 地形效果结算：结算上回合结束时停留的增益地形
    const updated = units.map((u) => {
      if (u.dead) return u;
      const terrain = map[u.row]?.[u.col]?.terrain;
      // 新回合开始：清空 acted/控制态/步数/攻击标记
      // 注意：敌人(劫匪)保持 immobilized=true，不清除
      let newU = {
        ...u,
        acted: false,
        immobilized: u.isEnemy ? u.immobilized : false,
        stunned: false,
        stepsUsedThisTurn: 0,
        attackedThisTurn: false,
      };

      // 增益地形：必须"上回合结束时就在此格"（即lastTerrain记录了该格）
      if (u.lastTerrain === terrain) {
        if (terrain === 'spring' && u.hp < u.maxHp) {
          newU = { ...newU, hp: Math.min(newU.hp + 1, newU.maxHp) };
          get().addLog(`💧 ${u.name} 停留在灵泉涌眼，气血+1`, 'system');
        }
        if (terrain === 'atk_boost') {
          newU = { ...newU, atk: Math.min(newU.atk + 1, 15) };
          get().addLog(`⚔ ${u.name} 停留在灵脉节点，修为+1`, 'system');
        }
        if (terrain === 'mnd_boost') {
          newU = { ...newU, mnd: Math.min(newU.mnd + 1, 5) };
          get().addLog(`🧘 ${u.name} 停留在悟道石台，心境+1`, 'system');
        }
      }

      // 瘴气停留额外扣血
      if (terrain === 'miasma') {
        const newHp = Math.max(0, newU.hp - 1);
        newU = { ...newU, hp: newHp, dead: newHp <= 0 };
        get().addLog(`☠ ${u.name} 停留在魔气侵蚀区，额外受到1点环境伤害`, 'damage');
        if (newHp <= 0) {
          get().addLog(`💀 ${u.name} 因持续瘴气而倒下！`, 'kill');
        }
      }

      // ② 记录本回合开始时的停留位置（供下回合结算用）
      newU.lastTerrain = terrain ?? null;

      return newU;
    });

    // 新回合重建行动队列（只包含存活玩家，按心境降序）
    const alivePlayerQueue = updated
      .filter((u) => !u.isEnemy && !u.dead)
      .sort((a, b) => b.mnd - a.mnd)
      .map((u) => u.id);

    set({
      units: updated,
      round: newRound,
      phase: 'select_unit',
      selectedUnitId: null,
      actionQueue: alivePlayerQueue,
      actionIndex: 0,
    });
  },

  enemyCounterAttack: (enemyId) => {
    const { units } = get();
    const enemy = units.find((u) => u.id === enemyId);
    if (!enemy || enemy.dead) return null;

    // 找所有相邻的玩家角色
    const adjacentPlayers = units.filter((u) =>
      !u.isEnemy && !u.dead && manhattan(enemy.row, enemy.col, u.row, u.col) === 1,
    );
    if (adjacentPlayers.length === 0) return null;

    // 随机选一个
    const target = adjacentPlayers[Math.floor(Math.random() * adjacentPlayers.length)];
    get().addLog(`🔄 ${enemy.name} 反击 ${target.name}`, 'action');
    return get().attack(enemyId, target.id);
  },

  processEnemyRound: () => {
    // A方案：劫匪完全静止不反击，此函数留空
  },

  addLog: (text, type) => {
    set((s) => ({
      logs: [...s.logs, { round: s.round, text, type }],
    }));
  },

  checkBattleEnd: () => {
    const { units } = get();
    const playersAlive = units.filter((u) => !u.isEnemy && !u.dead);
    const enemiesAlive = units.filter((u) => u.isEnemy && !u.dead);

    if (playersAlive.length === 0) {
      set({ battleOver: true, battleResult: 'lose', phase: 'battle_end' });
      get().addLog('💀 我方全军覆没...', 'system');
      return true;
    }
    if (enemiesAlive.length === 0) {
      set({ battleOver: true, battleResult: 'win', phase: 'battle_end' });
      get().addLog('🎉 所有劫匪已被击败，物资全部追回！', 'system');
      return true;
    }
    return false;
  },

  getRewards: () => {
    const { killCount } = get();
    // 0 击杀：无灵石、无线索（策划口径：S7A 零击杀也可进 S8a，但不发奖励）
    if (killCount === 0) return { stones: 0, clues: 0 };
    if (killCount <= 2) return { stones: 15, clues: 1 };
    if (killCount <= 4) return { stones: 22, clues: 2 };
    return { stones: 30, clues: 3 };
  },

  reset: () => set(initialState),

  getCurrentActorId: () => {
    const { units, actionQueue } = get();
    // 顺着心境队列找第一个未行动且存活的玩家
    for (const id of actionQueue) {
      const u = units.find((x) => x.id === id);
      if (u && !u.acted && !u.dead) return id;
    }
    return null;
  },

  /** moveUnitStep: 逐格移动动画调用，每次推进一格，累加1步 */
  moveUnitStep: (unitId, toRow, toCol) => {
    const { units, map } = get();
    const idx = units.findIndex((u) => u.id === unitId);
    if (idx === -1) return;
    const prev = units[idx];
    const updated = [...units];
    updated[idx] = {
      ...prev,
      row: toRow,
      col: toCol,
      stepsUsedThisTurn: prev.stepsUsedThisTurn + 1,
    };
    const terrain = map[toRow][toCol].terrain;
    const u = updated[idx];
    if (terrain === 'miasma') {
      updated[idx] = {
        ...u,
        atk: Math.max(1, u.atk - 1),
        mnd: Math.max(1, u.mnd - 1),
        hp: Math.max(0, u.hp - 1),
        dead: u.hp - 1 <= 0,
      };
      get().addLog(`☠ ${u.name} 踏入魔气侵蚀区，各属性-1！`, 'damage');
      if (u.hp - 1 <= 0) {
        get().addLog(`💀 ${u.name} 因瘴气而倒下！`, 'kill');
      }
    }
    set({ units: updated });
  },
}));
