/**
 * S7D · 坠魔谷决战地图
 *
 * 地图规格（18 列 × 12 行）：
 *   - A 阵营半区：行 0-4（顶部）
 *   - 河道：行 5-6（中部，2 行宽）
 *   - B 阵营半区：行 7-11（底部）
 *
 * 布局（象棋式对垒，方案 C）：
 *   - A 阵营出生点：行 0，列 3-6 + 列 10-13（左 4 + 右 4 = 8 格）
 *   - A 阵营水晶：行 0-1，列 7-9（3×2 = 6 格，与出生点同行夹在正中）
 *   - B 阵营水晶：行 10-11，列 7-9（3×2 = 6 格，镜像）
 *   - B 阵营出生点：行 11，列 3-6 + 列 10-13
 *   - 三座桥梁（2×2）：列 3-4 / 列 8-9 / 列 14-15，跨行 5-6
 *
 * 战术要义：
 *   - 出生即守晶（行 0/11 一字长蛇阵：SSSS CCC SSSS）
 *   - 水晶深藏己方后方，敌方占晶需穿越 10+ 格
 *   - 中桥直通双方水晶，是主战场
 *   - 侧翼桥（桥 1/3）适合包抄/偷袭
 */

// ==============================================================
// 基础尺寸常量
// ==============================================================

/** 地图总宽度（列数） */
export const S7D_MAP_COLS = 18;

/** 地图总高度（行数） */
export const S7D_MAP_ROWS = 12;

/** 河道起止行 */
export const S7D_RIVER_ROW_START = 5;
export const S7D_RIVER_ROW_END = 6;

/** 每座桥梁尺寸 */
export const S7D_BRIDGE_WIDTH = 2;
export const S7D_BRIDGE_HEIGHT = 2;

/** 三座桥梁的左上角列号 */
export const S7D_BRIDGE_COLS: [number, number, number] = [3, 8, 14];

// ==============================================================
// 瓦片类型定义（S7D 专属扩展）
// ==============================================================

/**
 * S7D 地图瓦片类型
 *
 * 【结构类】
 * - `normal`：普通可通行格
 * - `river`：河道（不可通行）
 * - `bridge`：桥梁（可通行，视觉上区分于普通格）
 * - `spawn_a`：A 阵营出生点（只有 A 方单位可在此登场）
 * - `spawn_b`：B 阵营出生点
 * - `crystal_a`：A 阵营水晶（A 方防守目标，B 方占领目标）
 * - `crystal_b`：B 阵营水晶
 *
 * 【增益/减益类（复用 S7A/B/C）】
 * - `spring`    ：💚 生命泉 - 停留至下回合开始，气血+1
 * - `atk_boost` ：⚔️ 修为台 - 停留至下回合开始，修为+1（永久）
 * - `mnd_boost` ：🧘 心境坛 - 停留至下回合开始，心境+1（永久）
 * - `miasma`    ：🔥 魔瘴地 - 停留至下回合开始，气血-1
 */
export type S7DTileType =
  | 'normal'
  | 'river'
  | 'bridge'
  | 'spawn_a'
  | 'spawn_b'
  | 'crystal_a'
  | 'crystal_b'
  | 'spring'
  | 'atk_boost'
  | 'mnd_boost'
  | 'miasma';

/** 单个瓦片数据结构 */
export interface S7DTile {
  row: number;
  col: number;
  tile: S7DTileType;
}

// ==============================================================
// 坐标表（供外部快速检索）
// ==============================================================

/** A 阵营出生点坐标（8 格） */
export const S7D_SPAWN_A: Array<[number, number]> = [
  [0, 3], [0, 4], [0, 5], [0, 6],
  [0, 10], [0, 11], [0, 12], [0, 13],
];

/** B 阵营出生点坐标（8 格） */
export const S7D_SPAWN_B: Array<[number, number]> = [
  [11, 3], [11, 4], [11, 5], [11, 6],
  [11, 10], [11, 11], [11, 12], [11, 13],
];

/** A 阵营水晶格坐标（6 格） */
export const S7D_CRYSTAL_A: Array<[number, number]> = [
  [0, 7], [0, 8], [0, 9],
  [1, 7], [1, 8], [1, 9],
];

/** B 阵营水晶格坐标（6 格） */
export const S7D_CRYSTAL_B: Array<[number, number]> = [
  [10, 7], [10, 8], [10, 9],
  [11, 7], [11, 8], [11, 9],
];

/** 三座桥梁的所有格子（每座 2×2 = 4 格，共 12 格） */
export const S7D_BRIDGES: Array<[number, number]> = (() => {
  const cells: Array<[number, number]> = [];
  for (const startCol of S7D_BRIDGE_COLS) {
    for (let dr = 0; dr < S7D_BRIDGE_HEIGHT; dr++) {
      for (let dc = 0; dc < S7D_BRIDGE_WIDTH; dc++) {
        cells.push([S7D_RIVER_ROW_START + dr, startCol + dc]);
      }
    }
  }
  return cells;
})();

// ==============================================================
// 功能瓦片坐标表（方案 A · 上下对称布局 · 26 格）
// ==============================================================
// 设计原则：
//   - 上下镜像对称，两阵营绝对公平
//   - 增益（💚/🧘）靠后（行 2/9），鼓励防守治疗
//   - 减益（🔥）靠前（行 3-4/7-8），河边高危
//   - 修为台（⚔️）分散，激励多路推进
//   - 全部落在可通行普通格，不与出生点/水晶/河/桥冲突

/** ⚔️ 修为台坐标（atk_boost × 8） */
export const S7D_ATK_BOOST: Array<[number, number]> = [
  // A 方（行 2 纵深 × 2 + 行 4 前沿 × 2）
  [2, 2], [2, 14], [4, 4], [4, 12],
  // B 方（行 9 纵深 × 2 + 行 7 前沿 × 2，上下镜像）
  [9, 2], [9, 14], [7, 4], [7, 12],
];

/** 💚 生命泉坐标（spring × 4） */
export const S7D_SPRING: Array<[number, number]> = [
  // A 方（行 2 左右对称）
  [2, 4], [2, 12],
  // B 方（行 9 左右对称）
  [9, 4], [9, 12],
];

/** 🧘 心境坛坐标（mnd_boost × 6） */
export const S7D_MND_BOOST: Array<[number, number]> = [
  // A 方（行 2 正中 + 行 3 最两侧）
  [2, 8], [3, 1], [3, 15],
  // B 方（镜像）
  [9, 8], [8, 1], [8, 15],
];

/** 🔥 魔瘴地坐标（miasma × 8） */
export const S7D_MIASMA: Array<[number, number]> = [
  // A 方（行 3 中路 × 2 + 行 4 近河 × 2）
  [3, 5], [3, 10], [4, 6], [4, 10],
  // B 方（镜像）
  [8, 5], [8, 10], [7, 6], [7, 10],
];

// ==============================================================
// 辅助判定函数
// ==============================================================

/** 判断坐标是否在河道行范围内 */
export function isRiverRow(row: number): boolean {
  return row >= S7D_RIVER_ROW_START && row <= S7D_RIVER_ROW_END;
}

/** 判断坐标是否为桥梁 */
export function isBridge(row: number, col: number): boolean {
  if (!isRiverRow(row)) return false;
  return S7D_BRIDGE_COLS.some((startCol) => col >= startCol && col < startCol + S7D_BRIDGE_WIDTH);
}

/** 判断坐标是否为 A 阵营出生点 */
export function isSpawnA(row: number, col: number): boolean {
  return S7D_SPAWN_A.some(([r, c]) => r === row && c === col);
}

/** 判断坐标是否为 B 阵营出生点 */
export function isSpawnB(row: number, col: number): boolean {
  return S7D_SPAWN_B.some(([r, c]) => r === row && c === col);
}

/** 判断坐标是否为 A 阵营水晶 */
export function isCrystalA(row: number, col: number): boolean {
  return S7D_CRYSTAL_A.some(([r, c]) => r === row && c === col);
}

/** 判断坐标是否为 B 阵营水晶 */
export function isCrystalB(row: number, col: number): boolean {
  return S7D_CRYSTAL_B.some(([r, c]) => r === row && c === col);
}

/** 判断坐标是否为 ⚔️ 修为台 */
export function isAtkBoost(row: number, col: number): boolean {
  return S7D_ATK_BOOST.some(([r, c]) => r === row && c === col);
}

/** 判断坐标是否为 💚 生命泉 */
export function isSpring(row: number, col: number): boolean {
  return S7D_SPRING.some(([r, c]) => r === row && c === col);
}

/** 判断坐标是否为 🧘 心境坛 */
export function isMndBoost(row: number, col: number): boolean {
  return S7D_MND_BOOST.some(([r, c]) => r === row && c === col);
}

/** 判断坐标是否为 🔥 魔瘴地 */
export function isMiasma(row: number, col: number): boolean {
  return S7D_MIASMA.some(([r, c]) => r === row && c === col);
}

/** 判断某格是否可通行（河道除桥外不可通行） */
export function isWalkable(row: number, col: number): boolean {
  if (row < 0 || row >= S7D_MAP_ROWS) return false;
  if (col < 0 || col >= S7D_MAP_COLS) return false;
  if (isRiverRow(row) && !isBridge(row, col)) return false;
  return true;
}

// ==============================================================
// 地图生成函数
// ==============================================================

/**
 * 生成完整的 18×12 S7D 地图。
 *
 * 瓦片优先级（从高到低）：
 *   1. 水晶格（A/B）        ← 结构类（不可被功能瓦片覆盖）
 *   2. 出生点（A/B）        ← 结构类
 *   3. 桥梁                 ← 结构类
 *   4. 河道                 ← 结构类
 *   5. 功能瓦片（⚔️/💚/🧘/🔥）← 仅在 normal 格上铺设
 *   6. 普通（normal）
 */
export function generateS7DMap(): S7DTile[][] {
  const map: S7DTile[][] = [];

  for (let r = 0; r < S7D_MAP_ROWS; r++) {
    const row: S7DTile[] = [];
    for (let c = 0; c < S7D_MAP_COLS; c++) {
      let tile: S7DTileType = 'normal';

      // ---- 结构类优先（不可被覆盖）----
      if (isCrystalA(r, c)) {
        tile = 'crystal_a';
      } else if (isCrystalB(r, c)) {
        tile = 'crystal_b';
      } else if (isSpawnA(r, c)) {
        tile = 'spawn_a';
      } else if (isSpawnB(r, c)) {
        tile = 'spawn_b';
      } else if (isRiverRow(r)) {
        tile = isBridge(r, c) ? 'bridge' : 'river';
      }
      // ---- 功能瓦片（只铺在 normal 格上）----
      else if (isAtkBoost(r, c)) {
        tile = 'atk_boost';
      } else if (isSpring(r, c)) {
        tile = 'spring';
      } else if (isMndBoost(r, c)) {
        tile = 'mnd_boost';
      } else if (isMiasma(r, c)) {
        tile = 'miasma';
      }

      row.push({ row: r, col: c, tile });
    }
    map.push(row);
  }

  return map;
}

// ==============================================================
// 瓦片展示元数据（供 UI 使用）
// ==============================================================

export const S7D_TILE_LABELS: Record<S7DTileType, string> = {
  normal: '',
  river: '河',
  bridge: '桥',
  spawn_a: '生',
  spawn_b: '生',
  crystal_a: '晶',
  crystal_b: '晶',
  spring: '💚',
  atk_boost: '⚔️',
  mnd_boost: '🧘',
  miasma: '🔥',
};

export const S7D_TILE_COLORS: Record<S7DTileType, string> = {
  normal: '#d8c9a8',      // 土黄（战场底色）
  river: '#2b6aa3',       // 深蓝（河水）
  bridge: '#8a5d2e',      // 木桥棕
  spawn_a: '#4a90e2',     // A 蓝
  spawn_b: '#e24a4a',     // B 红
  crystal_a: '#87cefa',   // A 浅蓝晶
  crystal_b: '#ffb6c1',   // B 浅红晶
  spring: '#6fcf97',      // 翠绿（生命）
  atk_boost: '#e67e22',   // 橙红（攻击）
  mnd_boost: '#9b59b6',   // 紫色（心境）
  miasma: '#5a3d5c',      // 暗紫黑（魔瘴）
};

export const S7D_TILE_DESC: Record<S7DTileType, string> = {
  normal: '普通地形',
  river: '河道 · 不可通行',
  bridge: '桥梁 · 唯一过河通道',
  spawn_a: '护道派出生点',
  spawn_b: '弑道派出生点',
  crystal_a: '护道派水晶 · 敌方占领 3 回合判胜',
  crystal_b: '弑道派水晶 · 敌方占领 3 回合判胜',
  spring: '💚 生命泉 · 停留至下回合开始，气血 +1',
  atk_boost: '⚔️ 修为台 · 停留至下回合开始，修为 +1（永久）',
  mnd_boost: '🧘 心境坛 · 停留至下回合开始，心境 +1（永久）',
  miasma: '🔥 魔瘴地 · 停留至下回合开始，气血 -1',
};
