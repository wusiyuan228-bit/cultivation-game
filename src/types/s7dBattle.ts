/**
 * S7D · 坠魔谷决战 — 战场运行时类型定义
 *
 * ═════════════════════════════════════════════════════════════════════
 *  设计核心
 * ═════════════════════════════════════════════════════════════════════
 *   - 6 名玩家（1 真人 + 5 AI），分 A / B 两方阵营（各 3 人）
 *   - 每名玩家 6 张可战卡（主角 + 5 张），分三区：
 *       · 战斗区（field）：最多 2 张，在地图上有坐标，UI 按「卡一 / 卡二」顺序展示
 *       · 手牌区（hand）：候补卡，未上场未阵亡
 *       · 弃牌区（grave）：已阵亡的卡
 *   - 地图 18×12，双方各 6 格水晶（3×2 矩形）
 *   - 回合：大回合 = 第 1 小轮次（卡一） + 第 2 小轮次（卡二）
 *   - 排序：按玩家主角进入 S7D 时的"心境冻结值"降序
 *   - 胜负：水晶破碎（HP 归零）OR 敌方 18 张全阵亡 OR 40 大回合平局
 *
 * ═════════════════════════════════════════════════════════════════════
 *  与 S7B 战斗引擎的关系
 * ═════════════════════════════════════════════════════════════════════
 *   - S7D 复用 src/systems/battle 下的底层引擎（BattleUnit / Modifier / Hook）
 *   - 本文件定义的是 *Store 层* 的状态（三区流转、水晶、回合队列、阵亡补位等）
 *   - 战斗执行（攻击结算、技能 hook）仍走 S7B 成熟引擎
 */

import type { CultivationType, HeroId } from '@/types/game';

// ==========================================================================
// 区域与序号
// ==========================================================================

/** 卡所在分区 */
export type BattleZone = 'field' | 'hand' | 'grave';

/** 战斗区的顺序槽位（卡一先行动，卡二后行动） */
export type FieldSlot = 1 | 2;

/** 阵营 */
export type BattleFaction = 'A' | 'B';

/** 玩家 owner id（真人 = 'player'，AI = 'ai1'..'ai5'） */
export type BattleOwnerId = string;

// ==========================================================================
// 战场位置
// ==========================================================================

export interface GridPos {
  row: number;
  col: number;
}

// ==========================================================================
// 卡实例（战场中每张可战卡的运行时数据）
// ==========================================================================

/**
 * 单张卡的战场实例
 *
 * 说明：
 *   - instanceId 是战场内唯一的 runtime id，格式约定 `${ownerId}:${cardId}`
 *     （同一玩家不会持有两张同卡，所以此格式唯一且可读）
 *   - cardId 是卡池的 id，既可以是主角（如 'hero_tangsan'）也可以是战卡
 *   - 数值（hp/atk/mnd）存三份：base / current / initial —— 对齐 S7B 引擎的 StatBox
 *     这里先以简化形式存（只存 current + max），后续接入引擎时再升级
 */
export interface BattleCardInstance {
  // ---- 身份 ----
  instanceId: string;            // 战场唯一 id（`${ownerId}:${cardId}`）
  cardId: string;                // 卡池 id（如 'card_xxx' 或 'hero_xxx'）
  ownerId: BattleOwnerId;        // 归属玩家
  faction: BattleFaction;        // A / B 阵营（由 owner 决定）
  isHero: boolean;               // 是否是主角卡（影响觉醒、召回等规则）
  heroId?: HeroId;               // 若 isHero=true，对应主角 id

  // ---- 展示 ----
  name: string;
  type: CultivationType;         // 修仙类型
  rarity: 'N' | 'R' | 'SR' | 'SSR' | '主角';
  portrait: string;              // 立绘路径

  // ---- 实时战况 ----
  hp: number;
  hpMax: number;
  atk: number;                   // 修为（骰数）
  mnd: number;                   // 心境（行动/移动步数上限）
  atkInitial: number;            // 开场初始修为
  mndInitial: number;            // 开场初始心境
  hpInitial: number;             // 开场初始气血

  // ---- 区域与位置 ----
  zone: BattleZone;
  /** 仅 zone='field' 时有效 */
  position?: GridPos;
  /** 仅 zone='field' 时有效：在玩家战斗区的槽位序号（1 = 卡一，2 = 卡二） */
  fieldSlot?: FieldSlot;
  /** 入场大回合（用于战报） */
  deployedAtRound?: number;

  // ---- 状态标记（战斗控制类）----
  immobilized: boolean;          // 本轮禁移
  stunned: boolean;              // 本轮禁行动
  hasMovedThisTurn: boolean;
  hasActedThisTurn: boolean;
  stepsUsedThisTurn: number;
  attackedThisTurn: boolean;

  // ---- 技能相关 ----
  /** SkillRegistry id 列表（接入引擎用） */
  registrySkills: string[];
  ultimateUsed: boolean;
  /** 本回合是否已用过技能（攻击/战技/绝技任一） */
  skillUsedThisTurn: boolean;
  /** 绝技 id */
  ultimateId?: string;
  /** 战斗技能 id */
  battleSkillId?: string;
  /** 战斗技能元数据（供 UI/checkSkillCastability 使用） */
  battleSkill: { name: string; desc: string } | null;
  /** 绝技元数据（供 UI/checkSkillCastability 使用） */
  ultimate: { name: string; desc: string } | null;

  // ---- 觉醒 ----
  awakened: boolean;
  form: 'base' | 'awakened';
  killCount: number;

  // ---- 生死标记 ----
  deadAtBigRound?: number;       // 阵亡时的大回合
  deadAtSubRound?: 1 | 2;        // 阵亡时的小轮次

  // ---- 上回合地形（用于下回合结算 buff 地形）----
  lastTerrain?: string | null;
}

// ==========================================================================
// 玩家（战场中 6 方之一）
// ==========================================================================

/**
 * 战场中的一方玩家（真人或 AI）
 *
 * 说明：
 *   - instanceIds 数组存本玩家的所有 6 张卡的 instanceId
 *   - 具体归属哪个区，查实例的 zone 字段
 *   - `mindFrozen` 是进入 S7D 时主角心境的冻结值，整场战斗排序用
 */
export interface BattlePlayer {
  ownerId: BattleOwnerId;        // 'player' / 'ai1' / 'ai2' / ...
  isHuman: boolean;              // true = 真人，false = AI
  heroId: HeroId;
  heroName: string;
  faction: BattleFaction;

  /** 排序冻结值：主角进入 S7D 时的心境，用于行动顺序（整场不变） */
  mindFrozen: number;

  /** 本玩家所有 6 张卡的 instance id */
  instanceIds: string[];

  /**
   * 战斗区槽位记录（存 instanceId，表示"这个槽位当前是谁"）
   *   - slot1 阵亡后补位的新卡填入 slot1
   *   - slot1 / slot2 可能为 undefined（表示槽位空）
   */
  fieldSlots: {
    slot1: string | undefined;
    slot2: string | undefined;
  };

  /** 是否还有战斗力（手牌+战斗区至少 1 张未阵亡） */
  alive: boolean;
}

// ==========================================================================
// 水晶
// ==========================================================================

/**
 * 水晶状态
 *
 * 规则：
 *   - 每方水晶由 6 格组成（一块 3×2 矩形）
 *   - HP 初始 6；每个大回合结束时，站在敌方水晶格上的存活棋子数 = 本回合扣血
 *   - HP 归 0 即被破
 */
export interface Crystal {
  faction: BattleFaction;        // 水晶归属方
  positions: GridPos[];          // 6 个格子
  hp: number;                    // 当前残血
  hpMax: number;                 // 初始 6
  /** 每大回合扣血记录（用于战报） */
  damageLog: Array<{
    bigRound: number;
    occupants: Array<{ instanceId: string; ownerId: BattleOwnerId; pos: GridPos }>;
    damage: number;
  }>;
}

// ==========================================================================
// 回合 / 行动队列
// ==========================================================================

/** 当前战场所处阶段 */
export type BattlePhase =
  | 'init'              // 初始化中
  | 'deploy_starter'    // 首发登场阶段（玩家选首发）——本阶段不使用此 Store
  | 'round_start'       // 大回合开始
  | 'sub_round_action'  // 小轮次内某单位行动中
  | 'reinforce'         // 阵亡补位选择中（有玩家需从手牌补位）
  | 'round_resolve'     // 大回合结算（水晶占领）
  | 'ended';            // 战斗结束

/** 某单位的一条行动队列项 */
export interface ActionQueueItem {
  /** 要行动的卡实例 id */
  instanceId: string;
  /** 所属玩家 */
  ownerId: BattleOwnerId;
  /** 玩家心境冻结值（排序依据，冗余方便调试） */
  mindFrozen: number;
  /** 小轮次内该卡的序号（1=卡一，2=卡二） */
  fieldSlot: FieldSlot;
  /** 是否已完成行动 */
  acted: boolean;
  /** 是否跳过（补位失败 / 阵亡等原因） */
  skipped: boolean;
}

/** 阵亡补位待办 */
export interface ReinforceTask {
  /** 要补位的玩家 */
  ownerId: BattleOwnerId;
  /** 空出的槽位序号 */
  slot: FieldSlot;
  /** 可选的手牌 instanceId 列表（过滤掉已阵亡的） */
  candidateInstanceIds: string[];
  /** 触发原因（战报用） */
  reason: string;
}

// ==========================================================================
// 战报
// ==========================================================================

/** S7D 战报条目类型（比 S7B 更轻量，业务层用） */
export type S7DLogKind =
  | 'battle_start'
  | 'round_start'
  | 'round_end'
  | 'sub_round_start'
  | 'sub_round_end'
  | 'turn_start'
  | 'turn_end'
  | 'deploy'                 // 卡从手牌进战斗区
  | 'move'
  | 'attack'
  | 'skill_cast'
  | 'damage'
  | 'heal'
  | 'death'
  | 'reinforce_request'      // 发起补位请求
  | 'reinforce_done'         // 补位完成
  | 'crystal_occupy'         // 某回合结束时水晶被占领
  | 'crystal_damage'         // 水晶扣血
  | 'crystal_broken'         // 水晶破碎
  | 'battle_victory'
  | 'battle_defeat'
  | 'battle_timeout'
  | 'text';                  // 纯文本

export interface S7DBattleLog {
  seq: number;
  bigRound: number;
  subRound?: 1 | 2;
  kind: S7DLogKind;
  text: string;
  actorId?: string;
  targetIds?: string[];
  payload?: Record<string, unknown>;
}

// ==========================================================================
// 战场根状态
// ==========================================================================

export interface S7DBattleState {
  // ---- 身份标识 ----
  /** 战场唯一 id（用于战报归档） */
  battleId: string;
  /** 玩家 heroId（真人） */
  playerHeroId: HeroId;
  /** 玩家阵营 */
  playerFaction: BattleFaction;

  // ---- 6 名玩家 ----
  players: BattlePlayer[];

  // ---- 所有卡实例（三区的卡都在这里，按 zone 区分）----
  units: Record<string, BattleCardInstance>; // key = instanceId

  // ---- 水晶 ----
  crystalA: Crystal;
  crystalB: Crystal;

  // ---- 回合系统 ----
  bigRound: number;                // 当前大回合（1..40）
  bigRoundMax: number;             // 上限（默认 40）
  subRound: 1 | 2;                 // 当前小轮次
  phase: BattlePhase;

  /** 当前小轮次的行动队列（按心境降序） */
  actionQueue: ActionQueueItem[];
  /** 当前轮到队列的索引 */
  currentActorIdx: number;

  // ---- 补位系统 ----
  /** 待补位队列（有人阵亡时压入；全部处理完才能继续回合） */
  reinforceQueue: ReinforceTask[];

  // ---- 胜负 ----
  winner: BattleFaction | 'draw' | null;
  endReason: 'crystal_broken' | 'all_dead' | 'timeout' | null;

  // ---- 战报 ----
  log: S7DBattleLog[];
  logSeq: number;
}

// ==========================================================================
// 初始化参数（供 initS7DBattle 使用）
// ==========================================================================

export interface S7DBattleInitParams {
  playerHeroId: HeroId;
  playerFaction: BattleFaction;
  /** 玩家备战挑的 5 张战卡 */
  playerDeployedCards: string[];
  /** 玩家选的 2 张首发卡 instanceId（实际传的是 cardId） */
  playerStarterCards: string[];
  /** 玩家主角冻结心境（进入 S7D 时读） */
  playerMindFrozen: number;

  /** 5 个 AI 的阵容（由 s7dAiLineup 生成，再补 mindFrozen） */
  aiLineups: Array<{
    ownerId: BattleOwnerId;       // 'ai1'..'ai5'
    heroId: HeroId;
    faction: BattleFaction;
    deployedCards: string[];      // 5 张
    starterCards: string[];       // 2 张
    mindFrozen: number;
  }>;

  /** 战场 id（可选，默认用时间戳） */
  battleId?: string;
}
