/**
 * S7B 战斗系统 Store — 宗门比武（玩家 vs 带技能AI）
 * 6×5地图，1主+1副 vs 1主+1副，最多 20 回合平局，一方全灭即胜负已分
 *
 * 关键差异（vs battleStore）：
 *   - 地图 6×5（5行6列），不是 4×10
 *   - 敌方是另一个带技能的角色组合（不是劫匪）
 *   - AI 不再静止，会移动+普攻+使用技能
 *   - 胜负：一方全灭即胜 / 20回合双方还活着则平局
 *   - 技能效果实装：蓝银囚笼 / 焚决·噬焰 / 邪灵诀·夺命
 */
import { create } from 'zustand';
import type { CultivationType } from '@/types/game';
import { findRegistryIdByName } from '@/data/skills_s7b';
import { SkillRegistry } from '@/systems/battle/skillRegistry';
import { HERO_BLUEPRINTS, type HeroBlueprint } from '@/data/heroBlueprints';
import { AWAKEN_TRIGGERS } from '@/data/awakeningTriggers';
import type {
  AttackContext,
  BattleUnit as EngineUnit,
  HookName,
  LogEntry as EngineLogEntry,
  StatBox,
  Modifier as EngineModifier,
} from '@/systems/battle/types';
import {
  globalModStore,
  resetGlobalModStore,
  resolveStatSet,
} from '@/systems/battle/e2Helpers';
import { applyDamagePipeline } from '@/systems/battle/damagePipeline';
import { cleanupOnRoundEnd } from '@/systems/battle/modifierSystem';
import {
  dispatchTurnStartHooks,
  dispatchTurnEndHooks,
  applyTurnStartChoice,
  type TurnStartDispatchCtx,
} from '@/systems/battle/turnStartDispatcher';

/**
 * 统一的技能名→注册id 反查。
 * 优先走 SkillRegistry.findIdByName（自动覆盖全部 112 条实装技能），
 * 未命中再回退到老的 SKILL_NAME_TO_REGISTRY_ID（兼容极少数别名）。
 *
 * BUGFIX（2026-05-01）：老 SKILL_NAME_TO_REGISTRY_ID 只维护了 26 条，
 * 导致 E1/E1-C 补入的 ~86 条通用 SSR/SR 技能在战斗中 hook 全部挂不上。
 * 改走 SkillRegistry.findIdByName 后，只要注册了就自动接入 hook 链。
 */
function resolveSkillRegId(name: string | undefined | null): string | undefined {
  if (!name) return undefined;
  const autoId = SkillRegistry.findIdByName(name);
  if (autoId) return autoId;
  // fallback：老表里可能有旧别名映射
  return findRegistryIdByName(name);
}

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
  /** 主动战斗技能是否已使用（每场1次，用于藤化原·天鬼搜身等 isActive=true 的 battle_skill） */
  battleSkillUsed?: boolean;
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
  /** 技能id（用于技能实装查询技能效果）—— 旧引擎用 */
  skillId?: string;
  /** 绝技id —— 旧引擎用 */
  ultimateId?: string;
  /**
   * 新引擎：SkillRegistry 技能 id 列表（本单位可触发的全部 hook 挂载点）
   * 例：['hero_xiaoyan.battle'] 表示萧焱挂了焚决·噬焰的全部 hook
   * 可选：若 UI 构造单位时未提供，initBattle 会根据 battleSkill.name/ultimate.name 自动映射
   */
  registrySkills?: string[];
  /** 标记：下一个"自己的行动轮"开始时应触发 immobilized=true（仅该行动轮，行动后清除） */
  immobileNextTurn?: boolean;

  // ============ 阶段 C · 觉醒相关 ============
  /** 对应的主角 id（"hero_tangsan" / "hero_xiaowu" 等），用于查 HERO_BLUEPRINTS */
  heroId?: string;
  /** 是否已觉醒（true 后不再触发） */
  awakened?: boolean;
  /** 当前形态 */
  form?: 'base' | 'awakened';
  /** 累计击杀敌人数（寒立觉醒用） */
  killCountByThisUnit?: number;
  /** 觉醒额外行动剩余次数（旺林万魂幡用） */
  extraActionGrantedThisTurn?: boolean;
  /** 斗帝血脉·庇护剩余次数（薰儿觉醒时由 autoModifier 设为 2） */
  bihuCounterRemaining?: number;
  /** E2 · 红蝶蛊惑：被蛊惑的目标，下一个行动轮强制攻击相邻友军 */
  charmedNextTurn?: boolean;
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

/**
 * E2 · 风属斗技落点计算
 * 在 anchor（攻击者）相邻 radius 曼哈顿距离内寻找合法空位（非障碍、非已被占用）
 * 返回距离 anchor 最近的一个，若没有则返回 null（按 Q-E2-1 方案B 整个攻击取消）
 */
function computeFengShuLandingPos(
  units: BattleUnit[],
  map: MapCell[][],
  anchor: { row: number; col: number },
  _victim: { id: string },
  radius: number,
): { row: number; col: number } | null {
  const candidates: Array<{ row: number; col: number; dist: number }> = [];
  const occupied = new Set<string>();
  for (const u of units) {
    if (u.dead) continue;
    if (u.id === _victim.id) continue; // 目标自己的格子可腾出
    occupied.add(`${u.row},${u.col}`);
  }
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      const d = manhattan(anchor.row, anchor.col, r, c);
      if (d === 0 || d > radius) continue;
      if (map[r]?.[c]?.terrain === 'obstacle') continue;
      if (occupied.has(`${r},${c}`)) continue;
      candidates.push({ row: r, col: c, dist: d });
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.dist - b.dist || a.row - b.row || a.col - b.col);
  return { row: candidates[0].row, col: candidates[0].col };
}

/**
 * E2 · 风属斗技 —— 返回所有合法落点（用于玩家选位 UI）
 * 与 computeFengShuLandingPos 同规则，但返回完整候选列表（按距离/行列排序）
 */
function computeFengShuAllCandidates(
  units: BattleUnit[],
  map: MapCell[][],
  anchor: { row: number; col: number },
  victim: { id: string },
  radius: number,
): Array<{ row: number; col: number }> {
  const candidates: Array<{ row: number; col: number; dist: number }> = [];
  const occupied = new Set<string>();
  for (const u of units) {
    if (u.dead) continue;
    if (u.id === victim.id) continue;
    occupied.add(`${u.row},${u.col}`);
  }
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      const d = manhattan(anchor.row, anchor.col, r, c);
      if (d === 0 || d > radius) continue;
      if (map[r]?.[c]?.terrain === 'obstacle') continue;
      if (occupied.has(`${r},${c}`)) continue;
      candidates.push({ row: r, col: c, dist: d });
    }
  }
  candidates.sort((a, b) => a.dist - b.dist || a.row - b.row || a.col - b.col);
  return candidates.map(({ row, col }) => ({ row, col }));
}

/**
 * 把 store 的 BattleUnit 映射成新引擎的 EngineUnit（StatBox 结构）
 * 仅用于 hook handler 只读访问；所有写操作应走 localEngine.changeStat
 */
function mapUnitToEngine(u: BattleUnit): EngineUnit {
  const mkBox = (n: number): StatBox => ({ base: n, current: n, initial: n });
  // ⚠ 关键修复（2026-05-10）：hp.initial 必须 = maxHp（开场满血），否则
  // 依赖"已损失气血"语义的技能（小舞儿八段摔·断魂、玄古天地等）会永远算出 0 伤害。
  const hpBox: StatBox = { base: u.maxHp, current: u.hp, initial: u.maxHp };
  return {
    id: u.id,
    name: u.name,
    type: u.type,
    owner: u.isEnemy ? 'P2' : 'P1',
    hp: hpBox,
    atk: mkBox(u.atk),
    mnd: mkBox(u.mnd),
    hpCap: u.maxHp,
    row: u.row,
    col: u.col,
    isAlive: !u.dead,
    form: u.form ?? 'base',
    awakened: u.awakened ?? false,
    skills: u.registrySkills ?? [],
    perTurn: {
      didBasicAttack: false,
      didUltimateAttack: false,
      damageDealtToOthers: 0,
      didCauseAnyDamage: false,
      hasMoved: false,
      extraActionsGranted: u.extraActionGrantedThisTurn ? 1 : 0,
      extraActionsConsumed: 0,
    },
    portrait: u.portrait,
    ultimateUsed: u.ultimateUsed,
    killCount: u.killCountByThisUnit ?? 0,
  };
}

/**
 * P5 · Q77 · 位置变化光环重算
 * 在任何单位移动后调用，让场上所有带 onPositionChange 钩子的技能实时重算。
 * 典型用例：古元·古族天火阵（aura），任一友军进入/离开相邻范围都要立即同步。
 */
function fireOnPositionChangeHooks(
  movedUnitId: string,
  units: BattleUnit[],
  addLog: (text: string, type: BattleLog['type']) => void,
): void {
  // 构造 minimal engine adapter（只支持读查询 + modifier 挂/销）
  const engine: any = {
    getUnit: (id: string) => {
      const u = units.find((x) => x.id === id && !x.dead);
      return u ? mapUnitToEngine(u) : undefined;
    },
    getAllUnits: () => units.filter((x) => !x.dead).map(mapUnitToEngine),
    getAlliesOf: (s: any) => {
      const self = units.find((x) => x.id === s.id);
      if (!self) return [];
      return units
        .filter((x) => x.isEnemy === self.isEnemy && x.id !== self.id && !x.dead)
        .map(mapUnitToEngine);
    },
    getEnemiesOf: (s: any) => {
      const self = units.find((x) => x.id === s.id);
      if (!self) return [];
      return units
        .filter((x) => x.isEnemy !== self.isEnemy && !x.dead)
        .map(mapUnitToEngine);
    },
    emit: (kind: string, _p: any, narrative: string, opts?: { severity?: string }) => {
      if (opts?.severity === 'debug') return;
      const type: BattleLog['type'] =
        kind === 'modifier_applied' || kind === 'modifier_expired' ? 'skill' : 'system';
      addLog(narrative, type);
    },
    attachModifier: (mod: any) => {
      globalModStore.attach(mod as EngineModifier);
    },
    detachModifier: (mid: string) => {
      globalModStore.detach(mid);
    },
    queryModifiers: (uid: string, k: any) => globalModStore.query(uid, k) as any,
    getRound: () => 0,
    changeStat: () => 0,
  };

  for (const u of units) {
    if (u.dead) continue;
    const skills = u.registrySkills ?? [];
    for (const sid of skills) {
      const reg = SkillRegistry.get(sid);
      if (!reg || !reg.onPositionChange) continue;
      const selfEng = engine.getUnit(u.id);
      if (!selfEng) continue;
      try {
        reg.onPositionChange(selfEng, movedUnitId, engine);
      } catch (e) {
        console.warn(`[onPositionChange] skill ${sid} threw`, e);
      }
    }
  }
}

/* ============ 地图常量 6×5 =========== */
export const MAP_ROWS = 5;
export const MAP_COLS = 6;

/* ============ 默认地图 6×5 — 宗门比武 ============
 *      0     1     2     3     4     5
 *   ┌─────┬─────┬─────┬─────┬─────┬─────┐
 * 0 │ 🟢P1│  ·  │  ·  │  ·  │ 🟡  │ 🔴E1│
 *   ├─────┼─────┼─────┼─────┼─────┼─────┤
 * 1 │ 🟢P2│ 💧  │  ·  │ ⬛  │  ·  │ 🔴E2│
 *   ├─────┼─────┼─────┼─────┼─────┼─────┤
 * 2 │  ·  │  ·  │ 🔵  │  ·  │ ☠️  │  ·  │
 *   ├─────┼─────┼─────┼─────┼─────┼─────┤
 * 3 │  ·  │ ☠️  │  ·  │ 💧  │  ·  │  ·  │
 *   ├─────┼─────┼─────┼─────┼─────┼─────┤
 * 4 │  ·  │ 🟡  │  ·  │  ·  │ ⬛  │  ·  │
 *   └─────┴─────┴─────┴─────┴─────┴─────┘
 * 共 30 格：普通 20 / 增益 5 / 减益 2 / 障碍 2 / 玩家出生 2（同时也是普通）/ 敌方 2
 */
function createDefaultMap(): MapCell[][] {
  const map: MapCell[][] = [];
  for (let r = 0; r < MAP_ROWS; r++) {
    const row: MapCell[] = [];
    for (let c = 0; c < MAP_COLS; c++) {
      row.push({ row: r, col: c, terrain: 'normal' });
    }
    map.push(row);
  }
  // 修为增长格（金色 ⚔）
  map[0][4] = { row: 0, col: 4, terrain: 'atk_boost' };
  map[4][1] = { row: 4, col: 1, terrain: 'atk_boost' };
  // 心境增长格（青色 🧘）
  map[2][2] = { row: 2, col: 2, terrain: 'mnd_boost' };
  // 气血恢复格（蓝色 💧）
  map[1][1] = { row: 1, col: 1, terrain: 'spring' };
  map[3][3] = { row: 3, col: 3, terrain: 'spring' };
  // 瘴气伤害格（紫红 ☠）
  map[2][4] = { row: 2, col: 4, terrain: 'miasma' };
  map[3][1] = { row: 3, col: 1, terrain: 'miasma' };
  // 障碍（黑色 ⬛）
  map[1][3] = { row: 1, col: 3, terrain: 'obstacle' };
  map[4][4] = { row: 4, col: 4, terrain: 'obstacle' };
  return map;
}

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
  /** 击杀数（玩家击杀敌方） */
  killCount: number;
  /** 战报 */
  logs: BattleLog[];
  /** 本回合是否已使用技能 */
  skillUsedThisTurn: boolean;
  /** 最近一次 useSkill 事件（用于 UI 订阅：如揭示敌方技能描述）；自增 ts 保证每次变化都能触发 useEffect */
  lastSkillEvent: { unitId: string; skillType: 'battle' | 'ultimate'; ts: number } | null;
  /** 战斗结束 */
  battleOver: boolean;
  /** 战斗结果 */
  battleResult: 'win' | 'lose' | 'draw' | null;
  /** 当前正在行动的角色索引（用于轮流行动） */
  actionQueue: string[];
  /** 当前行动角色在队列中的索引 */
  actionIndex: number;
  /** 当前行动方：player / enemy（AI） */
  currentSide: 'player' | 'enemy';

  /**
   * 玩家可控的 on_turn_start 待决策状态（2026-05-11 玩家选择弹窗）
   *
   * 当 turn_start dispatcher 检测到当前 actor 携带 interactiveOnTurnStart 元数据
   * 且为玩家控制时，会调用 store.requestTurnStartChoice(...) 写入此字段。
   * 此时 UI 应弹出"是否发动"对话框，玩家选定后调 confirmTurnStartChoice，
   * 拒绝则调 cancelTurnStartChoice。
   *
   * 该字段非 null 期间，回合 UI 应进入"暂停-等待玩家"语义，避免玩家在做无关操作时
   * 误关闭弹窗（也不阻塞行动 —— 玩家点否后即正常进入行动选择）。
   */
  pendingTurnStartChoice: {
    actorId: string;
    skillId: string;
    promptTitle: string;
    promptBody: string;
    choices: Array<{ targetId: string; stats?: Array<'atk' | 'mnd' | 'hp'> }>;
  } | null;
  /** 玩家点确认；store 内会调 applyTurnStartChoice 跑技能并清空 pendingTurnStartChoice */
  confirmTurnStartChoice: (
    targetId: string,
    stat: 'atk' | 'mnd' | 'hp' | undefined,
  ) => void;
  /** 玩家点否；store 仅清空 pendingTurnStartChoice，不结算技能 */
  cancelTurnStartChoice: () => void;

  // === 方法 ===
  initBattle: (
    playerUnits: Array<Omit<BattleUnit, 'acted' | 'dead' | 'ultimateUsed' | 'immobilized' | 'stunned' | 'lastTerrain' | 'stepsUsedThisTurn' | 'attackedThisTurn'>>,
    enemyUnits: Array<Omit<BattleUnit, 'acted' | 'dead' | 'ultimateUsed' | 'immobilized' | 'stunned' | 'lastTerrain' | 'stepsUsedThisTurn' | 'attackedThisTurn'>>,
  ) => void;
  selectUnit: (unitId: string) => void;
  cancelSelect: () => void;
  calcMoveRange: (unitId: string) => void;
  moveUnit: (unitId: string, toRow: number, toCol: number) => void;
  calcAttackRange: (unitId: string) => void;
  attack: (
    attackerId: string,
    defenderId: string,
    skillMod?: number,
    /**
     * 风属斗技玩家可控落点：
     *   undefined → 自动计算（默认，AI 用 / 不带技能时无效）
     *   { row, col } → 强制使用指定落点（玩家选定后传入）
     *   null → 玩家明确放弃发动 → 不传送（仍正常攻击）
     */
    fengshuOverride?: { row: number; col: number } | null,
  ) => DiceResult;
  /**
   * E2 · 风属斗技：返回攻击者相邻 2 格内的全部合法落点。
   * 给 UI 弹窗使用；若返回空数组表示无落点（攻击会被取消）
   */
  computeFengShuCandidates: (attackerId: string, defenderId: string) => Array<{ row: number; col: number }>;
  useSkill: (unitId: string, skillType: 'battle' | 'ultimate') => {
    skillId: string | null;
    skillType: 'battle' | 'ultimate';
    unit: BattleUnit;
  } | null;
  /**
   * 主动绝技执行（阶段 B 新增）
   * @param unitId    发动者 id
   * @param targetIds 目标 id 列表（由 UI 收集；单体 1 个，AOE 多个，全场类可留空）
   * @param pickedPosition  （可选）玩家选中的棋盘格位置（用于 position_pick selector 如小战祖树盾）
   * @returns         是否消耗了绝技次数（false = 前置检查未通过）
   */
  performUltimate: (unitId: string, targetIds: string[], pickedPosition?: { row: number; col: number }) => boolean;
  /**
   * 查询某单位主动绝技的前置检查结果（供 UI 按钮置灰/高亮候选目标）
   */
  ultimatePrecheck: (unitId: string) => {
    ok: boolean;
    reason?: string;
    candidateIds?: string[];
  };
  /**
   * 主动战斗技能执行（2026-05-10 新增）
   * 用于 isActive=true 且 kind='battle_skill' 的技能（如藤化原·天鬼搜身）
   * @param unitId    发动者 id
   * @param targetIds 目标 id 列表
   * @returns         是否消耗了"主动战斗技"次数（false = 前置未过）
   */
  performBattleSkillActive: (unitId: string, targetIds: string[]) => boolean;
  /**
   * 查询某单位主动战斗技能的前置检查结果（供 UI 按钮置灰/高亮候选目标）
   */
  battleSkillPrecheck: (unitId: string) => {
    ok: boolean;
    reason?: string;
    candidateIds?: string[];
  };
  endUnitTurn: (unitId: string) => void;
  advanceAction: () => void;
  startNewRound: () => void;
  processEnemyRound: () => void;
  addLog: (text: string, type: BattleLog['type']) => void;
  checkBattleEnd: () => boolean;
  reset: () => void;
  getCurrentActorId: () => string | null;
  moveUnitStep: (unitId: string, toRow: number, toCol: number) => void;
  /** 阶段 C：扫描并触发觉醒（关键节点调用） */
  checkAndTriggerAwakening: () => void;
}

const initialState = {
  initialized: false,
  map: [] as MapCell[][],
  units: [] as BattleUnit[],
  round: 1,
  maxRound: 20,
  selectedUnitId: null as string | null,
  phase: 'idle' as ActionPhase,
  moveRange: [] as Array<{ row: number; col: number }>,
  attackRange: [] as Array<{ row: number; col: number }>,
  lastDice: null as DiceResult | null,
  killCount: 0,
  logs: [] as BattleLog[],
  skillUsedThisTurn: false,
  lastSkillEvent: null as { unitId: string; skillType: 'battle' | 'ultimate'; ts: number } | null,
  battleOver: false,
  battleResult: null as 'win' | 'lose' | 'draw' | null,
  actionQueue: [] as string[],
  actionIndex: 0,
  currentSide: 'player' as 'player' | 'enemy',
  pendingTurnStartChoice: null as BattleState['pendingTurnStartChoice'],
};

/**
 * 模块级"本回合已派发 turn-start hook 的 unitId"集合
 * advanceAction 在切换到某个 actor 时调用 dispatchTurnStartHooks，
 * 但 advanceAction 可能在同一回合多次重入（如 endUnitTurn 中递归调用），
 * 必须保证每个 unit 在每个大回合至多触发一次 turn_start。
 *
 * 在 startNewRound 中会被清空。
 */
let _s7bTurnStartFiredThisRound = new Set<string>();
let _s7bTurnEndFiredThisRound = new Set<string>();

/**
 * 构造 TurnStartDispatchCtx —— 3 处派发点（initBattle / startNewRound / advanceAction / endUnitTurn）
 * 共用同一份逻辑，避免重复代码。
 *
 * 玩家弹窗能力（isPlayerControlled / requestTurnStartChoice）被绑定为 store 闭包：
 *   - isPlayerControlled：actor.isEnemy === false 即玩家方
 *   - requestTurnStartChoice：写入 store.pendingTurnStartChoice，UI 监听后弹窗
 */
function buildS7BTurnHookCtx(
  get: () => BattleState,
  set: (partial: Partial<BattleState>) => void,
): TurnStartDispatchCtx {
  return {
    snapshotAllUnits: () =>
      get().units.filter((u) => !u.dead).map(mapUnitToEngine),
    applyStatChange: (uid, stat, delta, opts) => {
      const cur = get().units;
      const i = cur.findIndex((x) => x.id === uid);
      if (i < 0) return 0;
      const tu = cur[i];
      const floor = opts.floor ?? 1;
      if (stat === 'hp') {
        const oldHp = tu.hp;
        let newHp = oldHp + delta;
        if (!opts.breakCap) newHp = Math.min(newHp, tu.maxHp);
        newHp = Math.max(0, newHp);
        // 不致死：调用方 floor 控制
        if (delta < 0 && opts.floor !== undefined) {
          newHp = Math.max(newHp, oldHp + Math.min(0, opts.floor - oldHp));
        }
        const next = [...cur];
        next[i] = { ...tu, hp: newHp, dead: newHp <= 0 ? true : tu.dead };
        set({ units: next });
        return newHp - oldHp;
      }
      if (stat === 'atk') {
        const oldVal = tu.atk;
        let newVal = Math.max(floor, oldVal + delta);
        if (!opts.breakCap) newVal = Math.min(newVal, 15);
        const next = [...cur];
        next[i] = { ...tu, atk: newVal };
        set({ units: next });
        return newVal - oldVal;
      }
      if (stat === 'mnd') {
        const oldVal = tu.mnd;
        let newVal = Math.max(floor, oldVal + delta);
        if (!opts.breakCap) newVal = Math.min(newVal, 5);
        const next = [...cur];
        next[i] = { ...tu, mnd: newVal };
        set({ units: next });
        return newVal - oldVal;
      }
      return 0;
    },
    addLog: (text, type) => get().addLog(text, type ?? 'skill'),
    getRound: () => get().round,
    isPlayerControlled: (uid) => {
      const u = get().units.find((x) => x.id === uid);
      return !!u && !u.isEnemy && !u.dead;
    },
    requestTurnStartChoice: (req) => {
      // 同一 actor 在一个回合内有多个 interactive 技能时，仅暂存第一个
      // （后续 dispatcher 已 continue 跳过，不会重复 set）
      if (get().pendingTurnStartChoice) return;
      set({ pendingTurnStartChoice: req });
      get().addLog(
        `📜 「${req.promptTitle}」可发动 —— 等待玩家选择`,
        'system',
      );
    },
  };
}

export const useS7BBattleStore = create<BattleState>((set, get) => ({
  ...initialState,

  initBattle: (playerInputs, enemyInputs) => {
    // E2 · 每次初始化时重置全局 modifier store，避免上一局残留
    resetGlobalModStore();
    // 🔧 2026-05-11 修复：清空跨场污染的 turn-hook fired 标记
    _s7bTurnStartFiredThisRound = new Set<string>();
    _s7bTurnEndFiredThisRound = new Set<string>();
    const map = createDefaultMap();

    /** 从技能名/技能绝技名反查 registry id，组成 registrySkills 列表 */
    const buildRegistrySkills = (u: {
      battleSkill?: { name: string } | null;
      ultimate?: { name: string } | null;
    }): string[] => {
      const ids: string[] = [];
      const b = u.battleSkill ? resolveSkillRegId(u.battleSkill.name) : undefined;
      const ult = u.ultimate ? resolveSkillRegId(u.ultimate.name) : undefined;
      if (b) ids.push(b);
      if (ult) ids.push(ult);
      return ids;
    };

    // 玩家方：左侧列(0) —— 从上至下放置
    const playerUnits: BattleUnit[] = playerInputs.map((u, i) => {
      // 推断 heroId：id 前缀匹配 HERO_BLUEPRINTS 的 key
      const heroId = Object.keys(HERO_BLUEPRINTS).find((k) => u.id.startsWith(k));
      return {
        ...u,
        row: i,
        col: 0,
        acted: false,
        dead: false,
        ultimateUsed: false,
        battleSkillUsed: false,
        immobilized: false,
        stunned: false,
        lastTerrain: null,
        stepsUsedThisTurn: 0,
        attackedThisTurn: false,
        registrySkills: (u as { registrySkills?: string[] }).registrySkills ?? buildRegistrySkills(u),
        heroId,
        awakened: false,
        form: 'base' as const,
        killCountByThisUnit: 0,
      };
    });

    // 敌方：右侧列(MAP_COLS-1=5) —— 从上至下放置
    const enemyUnits: BattleUnit[] = enemyInputs.map((u, i) => {
      const heroId = Object.keys(HERO_BLUEPRINTS).find((k) => u.id.startsWith(k));
      return {
        ...u,
        row: i,
        col: MAP_COLS - 1,
        isEnemy: true,
        acted: false,
        dead: false,
        ultimateUsed: false,
        battleSkillUsed: false,
        immobilized: false,
        stunned: false,
        lastTerrain: null,
        stepsUsedThisTurn: 0,
        attackedThisTurn: false,
        registrySkills: (u as { registrySkills?: string[] }).registrySkills ?? buildRegistrySkills(u),
        heroId,
        awakened: false,
        form: 'base' as const,
        killCountByThisUnit: 0,
      };
    });

    const allUnits = [...playerUnits, ...enemyUnits];

    // 行动队列：全部单位（双方）按心境值降序先后行动；同心境按"玩家优先"
    const queue = [...allUnits]
      .sort((a, b) => {
        if (b.mnd !== a.mnd) return b.mnd - a.mnd;
        return a.isEnemy ? 1 : -1;
      })
      .map((u) => u.id);

    set({
      initialized: true,
      map,
      units: allUnits,
      round: 1,
      maxRound: 20,
      selectedUnitId: null,
      phase: 'select_unit',
      moveRange: [],
      attackRange: [],
      lastDice: null,
      killCount: 0,
      logs: [{ round: 1, text: '⚔ 宗门比武开始！一方全灭即胜，20回合未分胜负则平局。', type: 'system' }],
      skillUsedThisTurn: false,
      lastSkillEvent: null,
      battleOver: false,
      battleResult: null,
      actionQueue: queue,
      actionIndex: 0,
      currentSide: 'player',
      pendingTurnStartChoice: null,
    });

    // 🔧 2026-05-11 修复：第 1 大回合开局，立即为队首 actor 派发 turn_start hook
    //   因为 advanceAction 只在 unit 行动后才被调用，不会派发"第一个 actor"的 turn_start
    {
      const firstActorId = get().getCurrentActorId();
      if (firstActorId && !_s7bTurnStartFiredThisRound.has(firstActorId)) {
        const firstActor = get().units.find((u) => u.id === firstActorId);
        if (firstActor && !firstActor.dead) {
          _s7bTurnStartFiredThisRound.add(firstActorId);
          const ctx = buildS7BTurnHookCtx(get, set);
          try {
            dispatchTurnStartHooks(firstActorId, ctx);
          } catch (e) {
            console.error('[s7bBattleStore] initial dispatchTurnStartHooks threw:', e);
          }
        }
      }
    }
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
        if (nr < 0 || nr >= MAP_ROWS || nc < 0 || nc >= MAP_COLS) continue;
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

    // 瘴气伤害格：路过不立即扣血/降三维。
    // 仅在 startNewRound 检测"上回合末停留位置=瘴气" → 扣 1 点 hp（详见 startNewRound）。
    // 与 battleStore.ts（剿匪）保持一致；策划修订 2026-05-11

    // 增益地形（修为/心境/气血）不立即生效，需要"停留到下回合行动时"才结算
    // 这里不做处理，会在 startNewRound 时统一结算

    set({ units: updated, moveRange: [] });
    get().calcAttackRange(unitId);
    // P5 · Q77：位置变化即时通知光环类技能重算
    fireOnPositionChangeHooks(unitId, updated, (text, type) => get().addLog(text, type ?? 'system'));
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

  computeFengShuCandidates: (attackerId, defenderId) => {
    const { units, map } = get();
    const attacker = units.find((u) => u.id === attackerId);
    const defender = units.find((u) => u.id === defenderId);
    if (!attacker || !defender) return [];
    if (!(attacker.registrySkills ?? []).includes('sr_nalanyanran.battle')) return [];
    return computeFengShuAllCandidates(units, map, attacker, defender, 2);
  },

  attack: (attackerId, defenderId, skillMod = 0, fengshuOverride) => {
    const { units } = get();
    const aIdx = units.findIndex((u) => u.id === attackerId);
    const dIdx = units.findIndex((u) => u.id === defenderId);
    if (aIdx === -1 || dIdx === -1) return { attackerDice: [], defenderDice: [], attackerSum: 0, defenderSum: 0, skillMod: 0, counterMod: 0, damage: 0 };    const attacker = units[aIdx];
    const defender = units[dIdx];

    /* ============================================================== */
    /*  E2 · 风属斗技预判（Q-E2-1 方案B：无合法落点则整个攻击取消）   */
    /*  支持玩家可控：fengshuOverride !== undefined 时使用玩家选定值  */
    /* ============================================================== */
    let fengshuLandingPos: { row: number; col: number } | null = null;
    if ((attacker.registrySkills ?? []).includes('sr_nalanyanran.battle')) {
      if (fengshuOverride !== undefined) {
        // 玩家显式传入：可能是落点 { row, col } 或 null（放弃发动）
        fengshuLandingPos = fengshuOverride;
        if (fengshuOverride === null) {
          get().addLog(
            `🌪 ${attacker.name} 选择不发动「风属斗技」`,
            'skill',
          );
        }
      } else {
        // 默认（AI / 未走 UI 的旧路径）：自动选最近落点
        fengshuLandingPos = computeFengShuLandingPos(
          get().units, get().map, attacker, defender, 2,
        );
        if (!fengshuLandingPos) {
          get().addLog(
            `🌪 风属斗技无合法落点，${attacker.name} 放弃本次进攻`,
            'skill',
          );
          // 方案B：失败整个攻击取消，返回空结果
          return { attackerDice: [], defenderDice: [], attackerSum: 0, defenderSum: 0, skillMod: 0, counterMod: 0, damage: 0 };
        }
      }
    }

    /* ============================================================== */
    /*  新引擎 · 7-phase Hook 轻量版（严格对齐契约 §3 顺序）          */
    /*  注：为保持 store 快照字段不变，本地实现了一个 mini-engine      */
    /*  让 SkillRegistry 的 hook 可以直接修改双方数值                  */
    /* ============================================================== */

    // —— 本次攻击的可变数值（ctx 的可写副本） ——
    let diceAttack = attacker.atk;
    let diceDefend = defender.atk;

    // E2：应用 stat_set modifier（镜像肠/化形镜像）——覆盖 diceAttack
    const attackerSet = resolveStatSet(attacker.id, 'atk');
    if (attackerSet !== null) diceAttack = attackerSet;
    const defenderSet = resolveStatSet(defender.id, 'atk');
    if (defenderSet !== null) diceDefend = defenderSet;
    const calcLog: Array<{ source: string; delta: number; note: string }> = [];
    const hookFiredSet = new Set<string>();
    // 新增的日志条目（按新引擎 LogEntry 格式）
    const engineLogs: BattleLog[] = [];
    const addEngineLog = (text: string, type: BattleLog['type'] = 'skill') => {
      engineLogs.push({ round: get().round, text, type });
    };

    // —— 可变的双方单位副本（hook 修改应作用于此，最终回写 updated） ——
    let newAttacker = { ...attacker };
    let newDefender = { ...defender };

    /**
     * 构造给 hook 使用的 engine 适配器：最小化 IBattleEngine 接口实现
     * 仅提供 store-local attack 流程需要的方法
     */
    const localEngine = {
      getUnit: (id: string) => {
        if (id === attacker.id) return mapUnitToEngine(newAttacker);
        if (id === defender.id) return mapUnitToEngine(newDefender);
        return undefined;
      },
      getAllUnits: () => units.map(mapUnitToEngine),
      getAlliesOf: (u: EngineUnit) => [], // 阶段 A 暂不需要
      getEnemiesOf: (u: EngineUnit) => [],
      emit: (_kind: string, _payload: any, narrative: string, opts?: { severity?: string }) => {
        const type: BattleLog['type'] =
          _kind === 'damage_applied' ? 'damage'
          : _kind === 'unit_leave' ? 'kill'
          : _kind === 'skill_passive_trigger' || _kind === 'skill_effect_applied' || _kind === 'skill_effect_blocked'
            ? 'skill'
            : 'system';
        // 仅把 highlight/climax/info 级别的文案入战报；debug 级别忽略
        if (opts?.severity !== 'debug') addEngineLog(narrative, type);
      },
      changeStat: (unitId: string, stat: 'hp' | 'atk' | 'mnd', delta: number, opts: {
        permanent: boolean;
        breakCap?: boolean;
        floor?: number;
        reason: string;
      }) => {
        // ★ 2026-05-10：hp 减少时走伤害管线
        if (stat === 'hp' && delta < 0) {
          const t0 = unitId === attacker.id ? newAttacker : unitId === defender.id ? newDefender : null;
          const pipeline = applyDamagePipeline(
            {
              targetUnitId: unitId,
              damage: -delta,
              attackerId: attacker.id,
              reason: opts.reason,
              currentHp: t0 ? t0.hp : 0,
            },
            (uid) => {
              if (uid === attacker.id) return newAttacker.hp;
              if (uid === defender.id) return newDefender.hp;
              const u = get().units.find((x) => x.id === uid);
              return u ? u.hp : undefined;
            },
          );
          if (pipeline.redirected) {
            addEngineLog(`💫 伤害被【古族祖灵结界】重定向`, 'skill');
          }
          if (pipeline.reducedBy > 0) {
            addEngineLog(`🛡【金帝天火阵】减免伤害 ${pipeline.reducedBy} 点`, 'skill');
          }
          if (pipeline.hpFloorTriggered) {
            addEngineLog(`✨ 触发气血触底保护`, 'skill');
          }
          unitId = pipeline.finalTargetId;
          delta = -pipeline.finalDamage;
        }
        const target = unitId === attacker.id ? newAttacker : unitId === defender.id ? newDefender : null;
        if (!target) return 0;
        const oldVal = stat === 'hp' ? target.hp : stat === 'atk' ? target.atk : target.mnd;
        let newVal = oldVal + delta;
        if (opts.floor !== undefined) newVal = Math.max(opts.floor, newVal);
        if (stat === 'hp') {
          if (!opts.breakCap) newVal = Math.min(newVal, target.maxHp);
          newVal = Math.max(0, newVal);
        }
        if (stat === 'hp') {
          target.hp = newVal;
          target.dead = newVal <= 0;
          if (opts.breakCap && newVal > target.maxHp) target.maxHp = newVal;
        }
        if (stat === 'atk') target.atk = newVal;
        if (stat === 'mnd') target.mnd = newVal;
        return newVal - oldVal;
      },
      attachModifier: (_mod: any) => {
        globalModStore.attach(_mod as EngineModifier);
        addEngineLog(`「${_mod.sourceSkillId ?? '?'}」挂载修饰器`, 'system');
      },
      queryModifiers: (uid: string, k: any) => {
        return globalModStore.query(uid, k) as any;
      },
      detachModifier: (mid: string, _r: string) => {
        globalModStore.detach(mid);
      },
      fireHook: () => {},
      fireTurnHook: () => {},
      getRound: () => get().round,
      nextSeq: () => 0,
      getCurrentActorId: () => attacker.id,
      triggerAwakening: () => {},
    };

    // —— AttackContext ——
    const ctx: AttackContext = {
      attackKind: 'basic',
      viaUltimate: false,
      segmentIndex: 0,
      attacker: mapUnitToEngine(newAttacker),
      defender: mapUnitToEngine(newDefender),
      diceAttack,
      diceDefend,
      aSum: 0,
      dSum: 0,
      skillId: undefined,
      hookFiredSet,
      calcLog,
    };

    /** 调用某方 skills 列表上的 hook，ctx 修改会写回 diceAttack/diceDefend */
    const fireHooks = (unit: BattleUnit, hookName: HookName) => {
      const key = `${unit.id}::${hookName}`;
      if (hookFiredSet.has(key)) return;
      hookFiredSet.add(key);
      // BUGFIX（2026-05-01）：让 handler 知道"本次 hook 由哪一方 fire 出来的"
      // 用以区分"本单位是 attacker 还是 defender"，解决无敌金身误触发 bug
      (ctx as any).__firingUnitId__ = unit.id;
      (ctx as any).__firingUnitIsAttacker__ = unit.id === newAttacker.id;
      for (const skillId of unit.registrySkills ?? []) {
        const skill = SkillRegistry.get(skillId);
        if (!skill) continue;
        const handler = skill.hooks[hookName];
        if (!handler) continue;
        try {
          (handler as any)(ctx, localEngine);
        } catch (e) {
          console.error('[s7b-hook]', hookName, skill.id, e);
        }
      }
      (ctx as any).__firingUnitId__ = undefined;
      (ctx as any).__firingUnitIsAttacker__ = undefined;
      // 同步回可变变量
      diceAttack = ctx.diceAttack;
      diceDefend = ctx.diceDefend;
    };

    // ————— Phase 1: on_before_roll —————
    fireHooks(newAttacker, 'on_before_roll');
    // ————— Phase 2: on_before_defend_roll —————
    fireHooks(newDefender, 'on_before_defend_roll');

    // ————— Phase 3: 投骰 —————
    const aDice = rollDice(diceAttack);
    const dDice = rollDice(diceDefend);
    const aSum = sum(aDice);
    const dSum = sum(dDice);
    ctx.aSum = aSum; ctx.dSum = dSum;
    fireHooks(newAttacker, 'on_after_attack_roll');

    // ————— Phase 4: on_before_being_attacked —————
    fireHooks(newDefender, 'on_before_being_attacked');

    // ————— Phase 5: on_damage_calc（双向）—————
    fireHooks(newAttacker, 'on_damage_calc');
    fireHooks(newDefender, 'on_damage_calc');

    // 计算最终伤害（§5.1）
    let damage = aSum - dSum;
    // ① 攻方/守方加减项
    for (const entry of calcLog) {
      if (entry.source.endsWith('__multiplier__')) continue;
      if (entry.source.endsWith('__cap__')) continue; // BUGFIX：cap 只在 ④ 阶段 min，不是加数
      if (entry.source === '__final_damage__') continue;
      damage += entry.delta;
    }
    // 克制关系（与 P0 的 damage_bonus 并列 ①）
    const counterMod = isCounter(attacker.type, defender.type) ? 1 : 0;
    if (counterMod) damage += counterMod;
    // 外部传入的 skillMod（兼容旧调用点）
    damage += skillMod;
    // ③ 翻倍类
    for (const entry of calcLog) {
      if (entry.source.endsWith('__multiplier__')) {
        damage = damage * entry.delta;
      }
    }
    // ④ 伤害封顶（无敌金身 damage_cap）
    for (const entry of calcLog) {
      if (entry.source.endsWith('__cap__')) {
        damage = Math.min(damage, entry.delta);
      }
    }
    // ⑦ 最低伤害保底
    damage = Math.max(1, damage);

    // 记录最终伤害供 on_after_hit 使用
    calcLog.push({ source: '__final_damage__', delta: damage, note: `最终伤害 = ${damage}` });

    // ★ 2026-05-10：普攻最终伤害走伤害管线（damage_redirect / damage_reduce / hp_floor）
    const pipelineResult = applyDamagePipeline(
      {
        targetUnitId: newDefender.id,
        damage,
        attackerId: newAttacker.id,
        reason: '攻击伤害',
        currentHp: newDefender.hp,
      },
      (uid) => {
        if (uid === newAttacker.id) return newAttacker.hp;
        if (uid === newDefender.id) return newDefender.hp;
        const u = units.find((x) => x.id === uid);
        return u ? u.hp : undefined;
      },
    );

    let realDamage = pipelineResult.finalDamage;
    let realDefenderId = pipelineResult.finalTargetId;
    if (pipelineResult.redirected) {
      const redirectTarget = units.find((x) => x.id === realDefenderId);
      addEngineLog(`💫 伤害被【古族祖灵结界】重定向：${newDefender.name} → ${redirectTarget?.name ?? realDefenderId}`, 'skill');
    }
    if (pipelineResult.reducedBy > 0) {
      addEngineLog(`🛡【金帝天火阵】减免伤害 ${pipelineResult.reducedBy} 点`, 'skill');
    }
    if (pipelineResult.hpFloorTriggered) {
      addEngineLog(`✨ ${units.find((x) => x.id === realDefenderId)?.name ?? realDefenderId} 触发气血触底保护`, 'skill');
    }

    // 落实伤害到对应单位
    let newHp: number;
    let redirectedUnit: BattleUnit | null = null;
    let redirectedNewHp: number | null = null;
    if (realDefenderId === newDefender.id) {
      newHp = Math.max(0, newDefender.hp - realDamage);
      newDefender = { ...newDefender, hp: newHp, dead: newHp <= 0 };
    } else {
      newHp = newDefender.hp;
      const rTarget = units.find((x) => x.id === realDefenderId);
      if (rTarget) {
        redirectedNewHp = Math.max(0, rTarget.hp - realDamage);
        redirectedUnit = { ...rTarget, hp: redirectedNewHp, dead: redirectedNewHp <= 0 };
      }
    }
    // 同步 ctx.defender（便于 Phase 6 的 hook 读到新状态）
    ctx.defender = mapUnitToEngine(newDefender);

    // ————— Phase 6: on_after_being_hit + on_after_hit —————
    // 即便 hp<=0 也要触发（契约 §3 时序：Phase 6 期间 isAlive 保持 true）
    fireHooks(newDefender, 'on_after_being_hit');
    fireHooks(newAttacker, 'on_after_hit');

    // —— 回写 units ——
    const updated = [...units];
    updated[aIdx] = newAttacker;
    updated[dIdx] = newDefender;
    if (redirectedUnit) {
      const rIdx = updated.findIndex((x) => x.id === redirectedUnit!.id);
      if (rIdx >= 0) updated[rIdx] = redirectedUnit;
    }

    // ————— Phase 7: unit_leave / on_kill —————
    let killed = false;
    const finalVictim = redirectedUnit ?? newDefender;
    const finalVictimHp = redirectedNewHp ?? newHp;
    if (finalVictimHp <= 0) {
      killed = true;
      if (finalVictim.isEnemy) {
        set((s) => ({ killCount: s.killCount + 1 }));
      }
      // 阶段 C：进攻方的 killCountByThisUnit +1（寒立觉醒触发用）
      if (finalVictim.isEnemy !== attacker.isEnemy) {
        newAttacker = {
          ...newAttacker,
          killCountByThisUnit: (newAttacker.killCountByThisUnit ?? 0) + 1,
        };
        updated[aIdx] = newAttacker;
      }
    }

    const result: DiceResult = { attackerDice: aDice, defenderDice: dDice, attackerSum: aSum, defenderSum: dSum, skillMod, counterMod, damage };

    // —— 先入主攻击战报 ——
    const counterText = counterMod ? ' [克制+1]' : '';
    const skillText = skillMod ? ` [技能+${skillMod}]` : '';
    const bonusEntries = calcLog
      .filter((e) => !e.source.endsWith('__multiplier__') && e.source !== '__final_damage__')
      .filter((e) => !e.source.endsWith('__cap__'))
      .filter((e) => e.delta !== 0);
    const bonusText = bonusEntries.length
      ? ` [${bonusEntries.map((e) => e.note).join(' / ')}]`
      : '';
    const multText = calcLog.some((e) => e.source.endsWith('__multiplier__'))
      ? ` [×${calcLog.filter((e) => e.source.endsWith('__multiplier__')).map((e) => e.delta).join('×')}]`
      : '';
    const capText = calcLog.some((e) => e.source.endsWith('__cap__'))
      ? ` [伤害上限封顶 ${Math.min(...calcLog.filter((e) => e.source.endsWith('__cap__')).map((e) => e.delta))}]`
      : '';

    set({ units: updated, lastDice: result });
    get().addLog(
      `${attacker.name} 攻击 ${defender.name}：${aSum}(${aDice.join('+')}) vs ${dSum}(${dDice.join('+')})${skillText}${bonusText}${counterText}${multText}${capText} → ${damage}点伤害`,
      'damage',
    );
    // —— 再入技能触发的战报（按产生顺序） ——
    for (const l of engineLogs) {
      get().addLog(l.text, l.type);
    }

    // ————— 【兼容路径】蓝银囚笼（P1 待在阶段 B 迁入新引擎）—————
    // 当玩家在本回合使用了蓝银囚笼技能(旧 skillId='skill_blueSilverCage')且当前攻击发生时，
    // 给防守方打上 immobileNextTurn 标记，让下一个行动轮开始时被缠足
    const s0 = get();
    if (s0.skillUsedThisTurn && attacker.skillId === 'skill_blueSilverCage' && !newDefender.dead) {
      const us = get().units.slice();
      const di = us.findIndex((u) => u.id === defender.id);
      if (di >= 0) {
        us[di] = { ...us[di], immobileNextTurn: true };
        set({ units: us });
        get().addLog(
          `🔗 蓝银囚笼命中！${defender.name} 下一个行动轮无法移动`,
          'skill',
        );
      }
    }

    if (killed) {
      get().addLog(`💀 ${defender.name} 被击杀！`, 'kill');
    }

    // —— E2 · 风属斗技传送（Phase 7 后）——
    if (fengshuLandingPos && !newDefender.dead) {
      const us = get().units.slice();
      const dIdxNow = us.findIndex((u) => u.id === defender.id);
      if (dIdxNow >= 0) {
        us[dIdxNow] = { ...us[dIdxNow], row: fengshuLandingPos.row, col: fengshuLandingPos.col };
        set({ units: us });
        get().addLog(
          `🌪 风属斗技：${defender.name} 被强制传送至 (${fengshuLandingPos.row},${fengshuLandingPos.col})`,
          'skill',
        );
      }
    }

    // ═══ 阶段 C · 觉醒扫描（关键节点：hp 变化后 + 击杀后） ═══
    get().checkAndTriggerAwakening();

    // ═══ 阶段 D · 立即结算检查（2026-05-10）═══
    // 击杀最后一个敌方/玩家全灭时立刻结束战斗，无需等所有单位都按"结束回合"
    get().checkBattleEnd();

    return result;
  },

  useSkill: (unitId, skillType) => {
    const { units } = get();
    const idx = units.findIndex((u) => u.id === unitId);
    if (idx === -1) return null;
    const unit = units[idx];

    if (skillType === 'ultimate') {
      if (unit.ultimateUsed || !unit.ultimate) return null;
      const updated = [...units];
      updated[idx] = { ...unit, ultimateUsed: true };
      set({
        units: updated,
        skillUsedThisTurn: true,
        lastSkillEvent: { unitId, skillType: 'ultimate', ts: Date.now() },
      });
      get().addLog(`⚡ ${unit.name} 释放绝技【${unit.ultimate.name}】！`, 'skill');
      return { skillId: unit.ultimateId ?? null, skillType: 'ultimate', unit };
    } else {
      if (!unit.battleSkill) return null;
      set({
        skillUsedThisTurn: true,
        lastSkillEvent: { unitId, skillType: 'battle', ts: Date.now() },
      });
      get().addLog(`✨ ${unit.name} 使用技能【${unit.battleSkill.name}】`, 'skill');
      return { skillId: unit.skillId ?? null, skillType: 'battle', unit };
    }
  },

  ultimatePrecheck: (unitId: string) => {
    const { units } = get();
    const u = units.find((x) => x.id === unitId);
    if (!u) return { ok: false, reason: '单位不存在' };
    if (!u.ultimate) return { ok: false, reason: '未装备绝技' };
    if (u.ultimateUsed) return { ok: false, reason: '绝技已使用' };

    // 找到新 SkillRegistry 对应 id
    const regId = resolveSkillRegId(u.ultimate.name);
    if (!regId) {
      // 未实装的绝技 —— 阶段 B 之后剩余的未实装绝技，按"可发动"处理（老 useSkill 逻辑兜底）
      return { ok: true };
    }
    const skill = SkillRegistry.get(regId);
    if (!skill) return { ok: true };
    if (!skill.precheck) return { ok: true };
    // 构造一个 engine-like 适配器，仅提供 precheck 需要的只读接口
    const adapter = {
      getEnemiesOf: (_s: any) => units.filter((x) => x.isEnemy !== u.isEnemy && !x.dead).map((x) => mapUnitToEngine(x)),
      getAlliesOf: (_s: any) => units.filter((x) => x.isEnemy === u.isEnemy && x.id !== u.id && !x.dead).map((x) => mapUnitToEngine(x)),
      getAllUnits: () => units.map(mapUnitToEngine),
      getUnit: (id: string) => { const x = units.find((v) => v.id === id); return x ? mapUnitToEngine(x) : undefined; },
      // 其余接口 precheck 不用
    } as any;
    return skill.precheck(mapUnitToEngine(u), adapter);
  },

  performUltimate: (unitId: string, targetIds: string[], pickedPosition?: { row: number; col: number }) => {
    const { units } = get();
    const uIdx = units.findIndex((x) => x.id === unitId);
    if (uIdx < 0) return false;
    const u = units[uIdx];
    if (!u.ultimate || u.ultimateUsed) return false;

    const regId = resolveSkillRegId(u.ultimate.name);
    if (!regId) {
      // 未实装的绝技，兜底：只标记已使用，不执行效果
      const updated = [...units];
      updated[uIdx] = { ...u, ultimateUsed: true };
      set({ units: updated, skillUsedThisTurn: true });
      get().addLog(`⚡ ${u.name} 释放绝技【${u.ultimate.name}】！（效果待实装）`, 'skill');
      return true;
    }
    const skill = SkillRegistry.get(regId);
    if (!skill || !skill.isActive || !skill.activeCast) return false;

    // —— 构造可变的 EngineUnit 副本集合，active handler 的 changeStat 会写回它们 ——
    const snapshots: Record<string, BattleUnit> = {};
    for (const x of units) snapshots[x.id] = { ...x };

    // 提供给 handler 使用的 engine-like 接口
    const engineLogs: BattleLog[] = [];
    const addEngineLog = (text: string, type: BattleLog['type'] = 'skill') => {
      engineLogs.push({ round: get().round, text, type });
    };
    const modifiersAccum: any[] = [];

    const adapter = {
      getUnit: (id: string) => {
        const x = snapshots[id];
        return x ? mapUnitToEngine(x) : undefined;
      },
      getAllUnits: () => Object.values(snapshots).map(mapUnitToEngine),
      getAlliesOf: (s: any) => {
        const self = snapshots[s.id];
        if (!self) return [];
        return Object.values(snapshots)
          .filter((x) => x.isEnemy === self.isEnemy && x.id !== self.id && !x.dead)
          .map(mapUnitToEngine);
      },
      getEnemiesOf: (s: any) => {
        const self = snapshots[s.id];
        if (!self) return [];
        return Object.values(snapshots)
          .filter((x) => x.isEnemy !== self.isEnemy && !x.dead)
          .map(mapUnitToEngine);
      },
      emit: (kind: string, _payload: any, narrative: string, opts?: { severity?: string }) => {
        const type: BattleLog['type'] =
          kind === 'damage_applied' ? 'damage'
          : kind === 'unit_leave' ? 'kill'
          : kind === 'skill_active_cast' || kind === 'skill_passive_trigger' ||
            kind === 'skill_effect_applied' || kind === 'skill_effect_blocked' ||
            kind === 'ownership_change'
            ? 'skill'
            : 'system';
        if (opts?.severity !== 'debug') addEngineLog(narrative, type);

        /* ============================================================
         * 2026-05-11：ownership_change（缘瑶·阴灵蔽日 等夺取类技能）
         *   事件驱动地翻转 snapshot 中目标的 isEnemy；
         *   set 阶段统一写回 store。
         *   payload 形态：{ targetId, from, to }
         * ============================================================ */
        if (kind === 'ownership_change') {
          const tid = (_payload as any)?.targetId;
          const t = tid ? snapshots[tid] : undefined;
          if (t) {
            t.isEnemy = !t.isEnemy;
          }
        }
      },
      changeStat: (
        id: string,
        stat: 'hp' | 'atk' | 'mnd',
        delta: number,
        opts: { permanent: boolean; breakCap?: boolean; floor?: number; reason: string },
      ) => {
        // ★ 2026-05-10：hp 减少时走伤害管线
        if (stat === 'hp' && delta < 0) {
          const t0 = snapshots[id];
          const pipeline = applyDamagePipeline(
            {
              targetUnitId: id,
              damage: -delta,
              attackerId: unitId, // 当前施法者
              reason: opts.reason,
              currentHp: t0 ? t0.hp : 0,
            },
            (uid) => {
              const t = snapshots[uid];
              return t ? t.hp : undefined;
            },
          );
          if (pipeline.redirected) {
            addEngineLog(`💫 伤害被【古族祖灵结界】重定向：${snapshots[id]?.name ?? id} → ${snapshots[pipeline.finalTargetId]?.name ?? pipeline.finalTargetId}`, 'skill');
          }
          if (pipeline.reducedBy > 0) {
            addEngineLog(`🛡【金帝天火阵】减免伤害 ${pipeline.reducedBy} 点`, 'skill');
          }
          if (pipeline.hpFloorTriggered) {
            addEngineLog(`✨ ${snapshots[pipeline.finalTargetId]?.name ?? pipeline.finalTargetId} 触发气血触底保护`, 'skill');
          }
          id = pipeline.finalTargetId;
          delta = -pipeline.finalDamage;
        }
        const t = snapshots[id];
        if (!t) return 0;
        const oldVal = stat === 'hp' ? t.hp : stat === 'atk' ? t.atk : t.mnd;
        let newVal = oldVal + delta;
        if (opts.floor !== undefined) newVal = Math.max(opts.floor, newVal);
        if (stat === 'hp') {
          if (!opts.breakCap) newVal = Math.min(newVal, t.maxHp);
          newVal = Math.max(0, newVal);
          t.hp = newVal;
          t.dead = newVal <= 0;
          if (opts.breakCap && newVal > t.maxHp) t.maxHp = newVal;
        }
        if (stat === 'atk') t.atk = newVal;
        if (stat === 'mnd') t.mnd = newVal;
        return newVal - oldVal;
      },
      attachModifier: (mod: any) => {
        globalModStore.attach(mod as EngineModifier);
        modifiersAccum.push(mod);
        addEngineLog(`「${mod.sourceSkillId}」挂载修饰器到 ${snapshots[mod.targetUnitId]?.name ?? '?'}`, 'system');
      },
      queryModifiers: (uid: string, k: any) => globalModStore.query(uid, k) as any,
      detachModifier: (mid: string) => { globalModStore.detach(mid); },
      fireHook: () => {},
      fireTurnHook: () => {},
      getRound: () => get().round,
      nextSeq: () => 0,
      getCurrentActorId: () => unitId,
      triggerAwakening: () => {},
    } as any;

    // —— 执行前置检查 ——
    let precheckCandidateIds: string[] = [];
    if (skill.precheck) {
      const pre = skill.precheck(mapUnitToEngine(u), adapter);
      if (!pre.ok) {
        get().addLog(`⚠️ ${pre.reason ?? '绝技发动失败'}`, 'skill');
        return false;
      }
      precheckCandidateIds = pre.candidateIds ?? [];
    }

    // —— BUGFIX（2026-05-01）：AOE 类绝技 UI 传入 targetIds=[]，需从 precheck 候选补充 ——
    // 对 cross_adjacent_enemies / all_adjacent_enemies / all_enemies 等"自动圈目标"的 selector，
    // 若调用方没显式传 targetIds，则使用 precheck.candidateIds 作为目标集合
    const aoeSelectors = new Set([
      'cross_adjacent_enemies',
      'all_adjacent_enemies',
      'all_enemies',
      'all_allies_incl_self',
    ]);
    let effectiveTargetIds = targetIds;
    if (
      (!effectiveTargetIds || effectiveTargetIds.length === 0) &&
      skill.targetSelector &&
      aoeSelectors.has(skill.targetSelector.kind) &&
      precheckCandidateIds.length > 0
    ) {
      effectiveTargetIds = precheckCandidateIds;
    }

    // —— 执行主体 ——
    const castResult = skill.activeCast!(mapUnitToEngine(u), effectiveTargetIds, adapter);
    if (!castResult.consumed) {
      // 前置或中途撤销，次数不消耗
      return false;
    }

    // —— 强制消耗绝技次数（BUGFIX：不依赖技能代码里手动 self.ultimateUsed = true） ——
    // 一场战斗内，一个角色的绝技只能释放 1 次（觉醒时会重置为 false 以解锁觉醒绝技）
    if (snapshots[u.id]) {
      snapshots[u.id].ultimateUsed = true;
    }

    // —— 对于"每段独立结算"的攻击型绝技（千仞雪/纳兰嫣然/佛怒火莲/万毒淬体/弑神击/万剑归宗/凤凰火雨/破天等）——
    // 2026-05-11 架构升级：从"硬编码白名单"改为"读取技能注册表的 skill.followUpAttack 字段"
    // 新增/修改瞄准型攻击绝技只需在技能文件里声明，store 不再需要改白名单
    const multiSegmentSkills: Record<string, {
      targets: string[];
      diceOverride?: (self: BattleUnit) => number;
      postHit?: (target: BattleUnit) => void;
    }> = {};

    if (skill.followUpAttack) {
      const fua = skill.followUpAttack;
      const targets =
        fua.perTarget === true
          ? effectiveTargetIds.slice()
          : effectiveTargetIds.slice(0, 1);
      multiSegmentSkills[regId] = {
        targets,
        diceOverride: fua.diceOverride
          ? (self: BattleUnit) =>
              // s7b 的 BattleUnit.atk 是 number 而不是 StatBox，做兼容封装
              fua.diceOverride!({ atk: { current: self.atk } } as any)
          : undefined,
        postHit: fua.postHit
          ? (target: BattleUnit) => {
              fua.postHit!(target as any, (text: string) => addEngineLog(text, 'skill'));
            }
          : undefined,
      };
    }

    // —— 先把 snapshot 回写（含 ultimateUsed、自损等即时变化）——
    const afterCastUnits = units.map((x) => snapshots[x.id] ?? x);
    set({
      units: afterCastUnits,
      skillUsedThisTurn: true,
      lastSkillEvent: { unitId, skillType: 'ultimate', ts: Date.now() },
    });
    get().addLog(`⚡ ${u.name} 释放绝技【${u.ultimate.name}】！`, 'skill');
    for (const l of engineLogs) get().addLog(l.text, l.type);

    // —— 展开多段攻击 ——
    const multi = multiSegmentSkills[regId];
    if (multi) {
      for (const tid of multi.targets) {
        const curUnits = get().units;
        const target = curUnits.find((x) => x.id === tid);
        const attackerCur = curUnits.find((x) => x.id === unitId);
        if (!target || target.dead || !attackerCur) continue;

        // 临时应用 diceOverride：我们在 attack 之前暂时提升 attacker.atk
        let restoreAtk: number | null = null;
        if (multi.diceOverride) {
          const overrideDice = multi.diceOverride(attackerCur);
          restoreAtk = attackerCur.atk;
          const us = [...get().units];
          const ai = us.findIndex((x) => x.id === unitId);
          us[ai] = { ...us[ai], atk: overrideDice };
          set({ units: us });
        }

        get().attack(unitId, tid, 0);

        // 恢复 atk
        if (restoreAtk !== null) {
          const us = [...get().units];
          const ai = us.findIndex((x) => x.id === unitId);
          us[ai] = { ...us[ai], atk: restoreAtk };
          set({ units: us });
        }

        // 后处理（万毒淬体的 atk -1 debuff）
        if (multi.postHit) {
          const us = [...get().units];
          const ti = us.findIndex((x) => x.id === tid);
          if (ti >= 0 && !us[ti].dead) {
            const copy = { ...us[ti] };
            multi.postHit(copy);
            us[ti] = copy;
            set({ units: us });
          }
        }
      }
    }

    /* ════════════════════════════════════════════════════════════ */
    /*  E2 · 绝技的 store 层真实执行（位移/复活/范围控制）           */
    /* ════════════════════════════════════════════════════════════ */

    // 天罡风暴：将目标强拉至攻击者相邻格，然后发起 1 次攻击
    if (regId === 'sr_fengxian.ultimate') {
      const tid = targetIds[0];
      const attackerCur = get().units.find((x) => x.id === unitId);
      const targetCur = get().units.find((x) => x.id === tid);
      if (attackerCur && targetCur && !targetCur.dead) {
        const landing = computeFengShuLandingPos(get().units, get().map, attackerCur, targetCur, 1);
        if (landing) {
          const us = [...get().units];
          const ti = us.findIndex((x) => x.id === tid);
          us[ti] = { ...us[ti], row: landing.row, col: landing.col };
          set({ units: us });
          get().addLog(
            `🌀 天罡风暴：${targetCur.name} 被强拉至 (${landing.row},${landing.col})`,
            'skill',
          );
          get().attack(unitId, tid, 0);
        } else {
          get().addLog(`🌀 天罡风暴无合法落点，强拉失败`, 'skill');
        }
      }
    }

    // 灵药·续命丹：复活已退场的非主角友军
    if (regId === 'sr_mupeiling.ultimate') {
      const tid = targetIds[0];
      const self = get().units.find((x) => x.id === unitId);
      const revivable = get().units.find(
        (x) => x.id === tid && x.dead && x.isEnemy === self?.isEnemy && !x.id.startsWith('hero_'),
      );
      if (revivable) {
        const us = [...get().units];
        const ti = us.findIndex((x) => x.id === tid);
        // 复活：hp=3，回到原位（若被占则最近空位）
        const originOccupied = us.some(
          (x) => !x.dead && x.row === revivable.row && x.col === revivable.col && x.id !== tid,
        );
        let pos = { row: revivable.row, col: revivable.col };
        if (originOccupied) {
          // 找自身阵营附近的空位
          const anchor = self ?? revivable;
          const found = computeFengShuLandingPos(
            us.filter((x) => x.id !== tid),
            get().map,
            anchor,
            revivable,
            3,
          );
          if (found) pos = found;
        }
        us[ti] = {
          ...us[ti],
          hp: 3,
          dead: false,
          row: pos.row,
          col: pos.col,
          acted: true, // 本轮不能立刻行动
        };
        set({ units: us });
        get().addLog(
          `💊 灵药·续命丹：${revivable.name} 以 3 点气血重新入场 (${pos.row},${pos.col})`,
          'skill',
        );
      }
    }

    // 黑泥潭·聚魂幡：退场时触发（通过技能 hook 已 emit），这里 MVP 不做真实移动，
    // 因为 activeCast 不适用（是 on_self_leave hook 技能）。store 层暂不处理。

    // 红蝶蛊惑：给目标打 charmedNextTurn 标记（下一个行动轮由 advanceAction 消费）
    if (regId === 'sr_hongdie.ultimate') {
      const tid = targetIds[0];
      const us = [...get().units];
      const ti = us.findIndex((x) => x.id === tid);
      if (ti >= 0 && !us[ti].dead) {
        us[ti] = { ...us[ti], charmedNextTurn: true };
        set({ units: us });
        get().addLog(
          `🦋 红蝶蛊惑：${us[ti].name} 下一行动轮将倒戈攻击其相邻友军`,
          'skill',
        );
      }
    }

    // P3 · 宁风致「七宝仙品·极致增幅」：self + 最多2名相邻友军串行对同一目标 resolveAttack
    if (regId === 'ssr_ningfengzhi.ult') {
      const tid = targetIds[0];
      const selfUnit = get().units.find((x) => x.id === unitId);
      if (selfUnit && tid) {
        const coAllies = get().units
          .filter(
            (x) =>
              !x.dead &&
              x.isEnemy === selfUnit.isEnemy &&
              x.id !== unitId &&
              Math.abs(x.row - selfUnit.row) + Math.abs(x.col - selfUnit.col) === 1,
          )
          .slice(0, 2);
        const attackerOrder = [selfUnit.id, ...coAllies.map((a) => a.id)];
        for (let i = 0; i < attackerOrder.length; i += 1) {
          const curUnits = get().units;
          const target = curUnits.find((x) => x.id === tid);
          const attackerCur = curUnits.find((x) => x.id === attackerOrder[i]);
          if (!target || target.dead) break; // 目标死了就不继续
          if (!attackerCur || attackerCur.dead) continue;
          get().addLog(
            `第 ${i + 1} 段：${attackerCur.name} 协同发起攻击`,
            'skill',
          );
          get().attack(attackerOrder[i], tid, 0);
        }
        // Q43：协同友军本轮不消耗行动 —— 不标记 acted
        // （不做额外处理即可：协同友军未走自身的 endUnitTurn）
        get().addLog(
          `🌟 七宝协同完毕（协同友军本轮未消耗行动）`,
          'skill',
        );
      }
    }

    // ═══ P2 · C 类位置选绝技：小战祖树盾 —— 在 pickedPosition 位置放置永久障碍 ═══
    if (regId === 'bsr_xiaozhan.ult' && pickedPosition) {
      const { row: pr, col: pc } = pickedPosition;
      const curMap = get().map;
      // 合法性：在棋盘内、当前非障碍、无存活单位占据
      const inBoard = curMap[pr]?.[pc] !== undefined;
      const notObstacle = inBoard && curMap[pr][pc].terrain !== 'obstacle';
      const unoccupied = !get().units.some(
        (x) => !x.dead && x.row === pr && x.col === pc,
      );
      if (inBoard && notObstacle && unoccupied) {
        const newMap = curMap.map((row) => row.map((cell) => ({ ...cell })));
        newMap[pr][pc].terrain = 'obstacle';
        set({ map: newMap });
        get().addLog(`🌳 萧族护盾：在 (${pr},${pc}) 布置了永久阻碍物`, 'skill');
      } else {
        get().addLog(`🌳 萧族护盾落点不合法（障碍/占据/越界）`, 'system');
      }
    }

    // ═══ 阶段 C · 觉醒扫描（绝技结算后，可能触发击杀/气血变化类觉醒） ═══
    get().checkAndTriggerAwakening();

    // ═══ 阶段 D · 立即结算检查（2026-05-10）═══
    // 绝技击杀最后一个敌方时立刻结束战斗
    get().checkBattleEnd();

    return true;
  },

  /* ═════════════════════════════════════════════════════════════ */
  /*  主动战斗技能（2026-05-10 新增 / Q-S7B-A1 藤化原天鬼搜身）       */
  /* ═════════════════════════════════════════════════════════════ */
  battleSkillPrecheck: (unitId: string) => {
    const { units } = get();
    const u = units.find((x) => x.id === unitId);
    if (!u) return { ok: false, reason: '单位不存在' };
    if (!u.battleSkill) return { ok: false, reason: '未装备战斗技能' };
    if (u.battleSkillUsed) return { ok: false, reason: '战斗技能本场已使用' };
    const regId = resolveSkillRegId(u.battleSkill.name);
    if (!regId) return { ok: false, reason: '该战斗技能不是主动技' };
    const skill = SkillRegistry.get(regId);
    if (!skill) return { ok: false, reason: '该战斗技能不是主动技' };
    if (!skill.isActive) return { ok: false, reason: '该战斗技能为被动技，自动触发' };
    if (!skill.precheck) return { ok: true };
    const adapter = {
      getEnemiesOf: (_s: any) => units.filter((x) => x.isEnemy !== u.isEnemy && !x.dead).map((x) => mapUnitToEngine(x)),
      getAlliesOf: (_s: any) => units.filter((x) => x.isEnemy === u.isEnemy && x.id !== u.id && !x.dead).map((x) => mapUnitToEngine(x)),
      getAllUnits: () => units.filter((x) => !x.dead).map(mapUnitToEngine),
      getUnit: (id: string) => { const x = units.find((v) => v.id === id); return x ? mapUnitToEngine(x) : undefined; },
    } as any;
    return skill.precheck(mapUnitToEngine(u), adapter);
  },

  performBattleSkillActive: (unitId: string, targetIds: string[]) => {
    const { units } = get();
    const uIdx = units.findIndex((x) => x.id === unitId);
    if (uIdx < 0) return false;
    const u = units[uIdx];
    if (!u.battleSkill || u.battleSkillUsed) return false;

    const regId = resolveSkillRegId(u.battleSkill.name);
    if (!regId) return false;
    const skill = SkillRegistry.get(regId);
    if (!skill || !skill.isActive || !skill.activeCast) return false;

    // —— 适配器（仅记录日志 + 提供查询接口） ——
    const engineLogs: BattleLog[] = [];
    const addEngineLog = (text: string, type: BattleLog['type'] = 'skill') => {
      engineLogs.push({ round: get().round, text, type });
    };
    const adapter = {
      getUnit: (id: string) => {
        const x = units.find((v) => v.id === id);
        return x ? mapUnitToEngine(x) : undefined;
      },
      getAllUnits: () => units.filter((x) => !x.dead).map(mapUnitToEngine),
      getAlliesOf: (s: any) =>
        units.filter((x) => x.isEnemy === s.isEnemy && x.id !== s.id && !x.dead).map(mapUnitToEngine),
      getEnemiesOf: (s: any) =>
        units.filter((x) => x.isEnemy !== s.isEnemy && !x.dead).map(mapUnitToEngine),
      emit: (kind: string, _payload: any, narrative: string, opts?: { severity?: string }) => {
        const type: BattleLog['type'] =
          kind === 'skill_active_cast' ? 'skill' : 'system';
        if (opts?.severity !== 'debug') addEngineLog(narrative, type);
      },
      changeStat: () => 0,
      attachModifier: () => {},
      queryModifiers: () => [],
      detachModifier: () => {},
      fireHook: () => {},
      fireTurnHook: () => {},
      getRound: () => get().round,
      nextSeq: () => 0,
      getCurrentActorId: () => unitId,
      triggerAwakening: () => {},
    } as any;

    // —— 前置检查 ——
    if (skill.precheck) {
      const pre = skill.precheck(mapUnitToEngine(u), adapter);
      if (!pre.ok) {
        get().addLog(`⚠️ ${pre.reason ?? '战斗技能发动失败'}`, 'skill');
        return false;
      }
    }

    // —— 执行主体（active handler 通常只 emit 事件） ——
    const result = skill.activeCast(mapUnitToEngine(u), targetIds, adapter);
    if (!result.consumed) return false;

    // —— store 层执行实际效果（按 regId 路由） ——
    if (regId === 'sr_tenghuayuan.battle') {
      // 天鬼搜身：与目标交换位置
      const targetId = targetIds[0];
      const cur = get().units;
      const si = cur.findIndex((x) => x.id === unitId);
      const ti = cur.findIndex((x) => x.id === targetId);
      if (si < 0 || ti < 0) return false;
      const us = [...cur];
      const sRow = us[si].row, sCol = us[si].col;
      us[si] = { ...us[si], row: us[ti].row, col: us[ti].col, battleSkillUsed: true };
      us[ti] = { ...us[ti], row: sRow, col: sCol };
      set({ units: us, skillUsedThisTurn: true, lastSkillEvent: { unitId, skillType: 'battle', ts: Date.now() } });
    } else {
      // 通用兜底：仅标记 battleSkillUsed
      const us = [...get().units];
      const si = us.findIndex((x) => x.id === unitId);
      if (si >= 0) {
        us[si] = { ...us[si], battleSkillUsed: true };
      }
      set({ units: us, skillUsedThisTurn: true, lastSkillEvent: { unitId, skillType: 'battle', ts: Date.now() } });
    }

    // —— 写入战报 ——
    for (const l of engineLogs) get().addLog(l.text, l.type);

    return true;
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

    // 🔧 2026-05-11 修复：行动结束时派发 on_turn_end hook
    //   覆盖 12 个 turn_end 类技能（凤霓·残云、奥斯卡·香肠、藤化原·搜身扫描、
    //   雪乃·古族驱散、塔莎·封印、唐雅·岚音、火雨皓·冰玉、莫彩环·蓄力、
    //   牧沛玲·妙手、刘媚·清羽、药尘·冷火、古元·古族天火阵 aura 等）
    if (!_s7bTurnEndFiredThisRound.has(unitId)) {
      _s7bTurnEndFiredThisRound.add(unitId);
      const ctx = buildS7BTurnHookCtx(get, set);
      try {
        dispatchTurnEndHooks(unitId, ctx);
      } catch (e) {
        console.error('[s7bBattleStore] dispatchTurnEndHooks threw:', e);
      }
    }
  },

  // ─────────────────────────────────────────────────────────────
  // 玩家可控的 turn-start 选择确认 / 拒绝（2026-05-11 玩家选择弹窗）
  // ─────────────────────────────────────────────────────────────
  confirmTurnStartChoice: (targetId, stat) => {
    const pending = get().pendingTurnStartChoice;
    if (!pending) return;
    const ctx = buildS7BTurnHookCtx(get, set);
    try {
      applyTurnStartChoice(pending.actorId, pending.skillId, targetId, stat, ctx);
    } catch (e) {
      console.error('[s7bBattleStore] applyTurnStartChoice threw:', e);
    }
    set({ pendingTurnStartChoice: null });
  },
  cancelTurnStartChoice: () => {
    const pending = get().pendingTurnStartChoice;
    if (!pending) return;
    get().addLog(
      `📜 玩家放弃发动「${pending.promptTitle}」`,
      'system',
    );
    set({ pendingTurnStartChoice: null });
  },

  advanceAction: () => {
    const state = get();
    if (state.battleOver) return;

    // 检查本回合是否所有单位（双方）都已行动
    const allUnits = state.units.filter((u) => !u.dead);
    const allActed = allUnits.every((u) => u.acted);

    if (allActed) {
      // 检查战斗结束
      if (get().checkBattleEnd()) return;
      // 开始新回合
      get().startNewRound();
    } else {
      // 判定下一个行动者是我方还是AI
      const nextActorId = get().getCurrentActorId();
      const nextActor = nextActorId ? state.units.find((u) => u.id === nextActorId) : null;
      if (nextActor) {
        // E2 · 藤化原 · 天鬼搜身 —— 已改为主动战斗技（玩家在自己行动轮点按钮 → 选目标），
        // 此处不再硬编码自动触发；保留兼容：如果 AI 携带本技能且未使用，AI 决策层会调用 performBattleSkillActive

        // E2 · Q-E2-3 方案A：红蝶蛊惑消费 —— 行动开始时剥夺控制权
        if (nextActor.charmedNextTurn && !nextActor.dead) {
          // 找出其相邻的"原友军"（与自身同 isEnemy 值）
          const cur = get().units;
          const victim = cur.find((x) => x.id === nextActor.id)!;
          const adjacent = cur
            .filter(
              (x) =>
                !x.dead &&
                x.id !== victim.id &&
                x.isEnemy === victim.isEnemy &&
                manhattan(victim.row, victim.col, x.row, x.col) === 1,
            )
            .sort((a, b) => (a.id < b.id ? -1 : 1)); // 按 id 字典序

          set({ currentSide: victim.isEnemy ? 'enemy' : 'player' });
          get().addLog(
            `🦋 ${victim.name} 被红蝶蛊惑！本行动轮倒戈攻击相邻友军（${adjacent.length} 个）`,
            'skill',
          );

          // 依次攻击
          for (const ally of adjacent) {
            const curVictim = get().units.find((x) => x.id === victim.id);
            if (!curVictim || curVictim.dead) break;
            const curAlly = get().units.find((x) => x.id === ally.id);
            if (!curAlly || curAlly.dead) continue;
            // 仍然相邻才打（可能被前一次攻击位移打掉）
            if (manhattan(curVictim.row, curVictim.col, curAlly.row, curAlly.col) !== 1) continue;
            get().attack(victim.id, ally.id, 0);
          }

          // 消费 marker 并结束行动轮
          {
            const us = [...get().units];
            const vi = us.findIndex((x) => x.id === victim.id);
            if (vi >= 0) us[vi] = { ...us[vi], charmedNextTurn: false };
            set({ units: us });
          }
          get().addLog(`🦋 红蝶蛊惑效果结束`, 'system');
          get().endUnitTurn(victim.id);
          // 推进
          setTimeout(() => get().advanceAction(), 0);
          return;
        }

        set({ currentSide: nextActor.isEnemy ? 'enemy' : 'player' });
        // 🔧 2026-05-11 修复：在 actor 行动开始前派发 on_turn_start hook
        //   原因：3 套 store 的 BattleEngine.fireTurnHook 全为空函数，导致 8+ 个
        //   on_turn_start 主动/被动技能（云鹊子·窃元、谷鹤·聚元炉、凝荣荣·七宝加持、
        //   萧炎觉醒·焚天、雅妃·补给、黎沐婉·清思 等）从未被触发。
        //   现在通过公共 dispatcher 让 hook 自动结算，本批次仅含"自动逻辑"，
        //   后续会再叠加玩家选择弹窗（云鹊子选目标/选属性等）。
        if (!_s7bTurnStartFiredThisRound.has(nextActor.id)) {
          _s7bTurnStartFiredThisRound.add(nextActor.id);
          const ctx = buildS7BTurnHookCtx(get, set);
          try {
            dispatchTurnStartHooks(nextActor.id, ctx);
          } catch (e) {
            console.error('[s7bBattleStore] dispatchTurnStartHooks threw:', e);
          }
        }
        // 若为AI方，UI 层会监听 currentSide 变化并触发 runAiTurn()
      }
    }
  },

  startNewRound: () => {
    const { round, maxRound, units, map } = get();
    const newRound = round + 1;
    if (newRound > maxRound) {
      // 20回合仍未分胜负 → 平局
      set({ battleOver: true, battleResult: 'draw', phase: 'battle_end' });
      get().addLog(`⏰ 已达最大回合数 ${maxRound}，战斗平局！`, 'system');
      return;
    }

    get().addLog(`── 第 ${newRound} 回合开始 ──`, 'system');

    // E2 · Q-E2-2 方案A：在新大回合 turnCycle 递增瞬间清除所有 round_remain modifier
    const cleanupEngine = {
      emit: (kind: string, _payload: any, narrative: string, opts?: { severity?: string }) => {
        if (opts?.severity !== 'debug') {
          get().addLog(narrative, 'system');
        }
        void kind;
      },
    } as any;
    cleanupOnRoundEnd(globalModStore, cleanupEngine);

    // 🔧 2026-05-11 修复：清空"本回合已派发 turn-start"标记，让新回合再次能派发
    _s7bTurnStartFiredThisRound = new Set<string>();
    _s7bTurnEndFiredThisRound = new Set<string>();

    // ① 地形效果结算：结算上回合结束时停留的增益地形
    const updated = units.map((u) => {
      if (u.dead) return u;
      const terrain = map[u.row]?.[u.col]?.terrain;
      // 新回合开始：清空 acted/控制态/步数/攻击标记
      // 注意：immobilized 因是"技能施加的"（如蓝银囚笼），只持续下一个行动轮
      //       按规则设计：施加时标记 immobileNextTurn=true，下一个行动轮开始时消费为 immobilized=true
      //       P5 · 同时检查 modifierStore 里的 disable_move（新引擎路径，如塘散·蓝银囚笼 新版 hook）
      const disableMoveMods = globalModStore.query(u.id, 'disable_move');
      const hasDisableMoveMod = disableMoveMods.length > 0;
      const willImmobile = !!u.immobileNextTurn || hasDisableMoveMod;
      let newU = {
        ...u,
        acted: false,
        immobilized: willImmobile,
        immobileNextTurn: false,
        stunned: false,
        stepsUsedThisTurn: 0,
        attackedThisTurn: false,
      };
      if (willImmobile) {
        get().addLog(`🔗 ${u.name} 因蓝银囚笼的缠绕，本行动轮无法移动`, 'system');
        // P5 · 消费 disable_move modifier（next_turn 持续一轮后驱散，避免永久缠绕）
        for (const m of disableMoveMods) {
          globalModStore.detach(m.id);
        }
      }

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

      // 瘴气停留扣血：上回合末停留在 miasma → 本回合开始时 hp-1
      if (terrain === 'miasma' && u.lastTerrain === terrain) {
        const newHp = Math.max(0, newU.hp - 1);
        newU = { ...newU, hp: newHp, dead: newHp <= 0 };
        get().addLog(`☠ ${u.name} 停留在魔气侵蚀区，气血-1`, 'damage');
        if (newHp <= 0) {
          get().addLog(`💀 ${u.name} 因持续瘴气而倒下！`, 'kill');
        }
      }

      // ② 记录本回合开始时的停留位置（供下回合结算用）
      newU.lastTerrain = terrain ?? null;

      return newU;
    });

    // 新回合重建行动队列（双方存活单位按心境降序，同心境玩家优先）
    const newQueue = updated
      .filter((u) => !u.dead)
      .sort((a, b) => {
        if (b.mnd !== a.mnd) return b.mnd - a.mnd;
        return a.isEnemy ? 1 : -1;
      })
      .map((u) => u.id);

    // 找出首个行动者判定 side
    const firstUnit = updated.find((u) => u.id === newQueue[0]);
    const firstSide: 'player' | 'enemy' = firstUnit?.isEnemy ? 'enemy' : 'player';

    set({
      units: updated,
      round: newRound,
      phase: 'select_unit',
      selectedUnitId: null,
      actionQueue: newQueue,
      actionIndex: 0,
      currentSide: firstSide,
    });

    // ═══ 阶段 C · 觉醒扫描（大回合开始保底） ═══
    get().checkAndTriggerAwakening();

    // 🔧 2026-05-11 修复：新大回合首个 actor 派发 turn_start hook
    {
      const firstActorId = newQueue[0];
      if (firstActorId && !_s7bTurnStartFiredThisRound.has(firstActorId)) {
        const firstActor = get().units.find((u) => u.id === firstActorId);
        if (firstActor && !firstActor.dead) {
          _s7bTurnStartFiredThisRound.add(firstActorId);
          const ctx = buildS7BTurnHookCtx(get, set);
          try {
            dispatchTurnStartHooks(firstActorId, ctx);
          } catch (e) {
            console.error('[s7bBattleStore] new-round dispatchTurnStartHooks threw:', e);
          }
        }
      }
    }
  },

  processEnemyRound: () => {
    // 每个AI单位单独驱动，由 UI 层监听 currentSide='enemy' 时触发 runAiTurn
    // 此函数保留为空，供兼容
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

    if (playersAlive.length === 0 && enemiesAlive.length === 0) {
      set({ battleOver: true, battleResult: 'draw', phase: 'battle_end' });
      get().addLog('⚰ 双方同归于尽，战斗平局！', 'system');
      return true;
    }
    if (playersAlive.length === 0) {
      set({ battleOver: true, battleResult: 'lose', phase: 'battle_end' });
      get().addLog('💀 我方全员倒下，挑战失败...', 'system');
      return true;
    }
    if (enemiesAlive.length === 0) {
      set({ battleOver: true, battleResult: 'win', phase: 'battle_end' });
      get().addLog('🎉 敌方全员倒下，宗门比武获胜！', 'system');
      return true;
    }
    return false;
  },

  reset: () => set(initialState),

  getCurrentActorId: () => {
    const { units, actionQueue } = get();
    // 顺着心境队列找第一个未行动且存活的单位（双方都包含）
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
    // 瘴气伤害格：路过不立即生效；仅在 startNewRound 阶段对"上回合末停留位置=瘴气"扣 1 hp。
    // 这里保留 terrain/u 解构以便未来扩展，不做即时处理。
    void terrain; void u;
    set({ units: updated });
    // P5 · Q77：位置变化即时通知光环类技能重算
    fireOnPositionChangeHooks(unitId, updated, (text, type) => get().addLog(text, type ?? 'system'));
  },

  /* ============================================================== */
  /*  阶段 C · 觉醒扫描与触发                                          */
  /* ============================================================== */
  /**
   * 扫描所有存活主角，若满足觉醒条件则原子替换数值/技能/形态。
   * 关键调用节点：
   *   - 每次 attack 落地后（defender.dead 可能触发"小舞儿退场 → 塘散觉醒"）
   *   - 每次 changeStat(hp) 后（"自身 hp 降至1 → 小舞儿觉醒"）
   *   - 每次大回合开始（"累计击杀≥2 → 寒立觉醒"，保底）
   *   - 每次对外数据改写后调用一次亦可（幂等）
   *
   * 实现要点（Q25-B）：
   *   - 打断性：从本函数返回后，调用方应让流程"按新数值续算"。
   *     S7B 的攻击链是同步原子的 attack() 调用，调用方在 attack() 之后
   *     调用本函数即可保证"下一条战报前完成觉醒"。
   *   - 一局只能觉醒一次：由 unit.awakened 字段保证幂等。
   *   - 已退场也能觉醒：本扫描含已 dead 的主角，若条件满足会原地复活为觉醒形态。
   */
  checkAndTriggerAwakening: () => {
    const { units } = get();

    // —— 构造一次引擎适配器供触发函数使用（复用 mapUnitToEngine 快照）——
    const adapter = {
      getAllUnits: () => units.map(mapUnitToEngine),
      getUnit: (id: string) => {
        const u = units.find((x) => x.id === id);
        return u ? mapUnitToEngine(u) : undefined;
      },
      getAlliesOf: () => [],
      getEnemiesOf: () => [],
      emit: () => {},
      changeStat: () => 0,
      attachModifier: () => {},
      queryModifiers: () => [],
      detachModifier: () => {},
      fireHook: () => {},
      fireTurnHook: () => {},
      getRound: () => get().round,
      nextSeq: () => 0,
      getCurrentActorId: () => null,
      triggerAwakening: () => {},
    } as any;

    // —— 扫描 ——
    const toAwaken: string[] = [];
    for (const u of units) {
      if (u.awakened) continue;
      if (!u.heroId) continue;
      const bp: HeroBlueprint | undefined = HERO_BLUEPRINTS[u.heroId];
      if (!bp) continue;
      const trigger = AWAKEN_TRIGGERS[bp.awakenTrigger];
      if (!trigger) continue;
      try {
        if (trigger(mapUnitToEngine(u), adapter)) {
          toAwaken.push(u.id);
        }
      } catch (e) {
        console.error('[awakening] trigger err', bp.awakenTrigger, e);
      }
    }

    if (toAwaken.length === 0) return;

    // —— 执行觉醒（同步 store 层 BattleUnit）——
    const updated = [...get().units];
    for (const uid of toAwaken) {
      const idx = updated.findIndex((x) => x.id === uid);
      if (idx < 0) continue;
      const prev = updated[idx];
      if (prev.awakened || !prev.heroId) continue;
      const bp = HERO_BLUEPRINTS[prev.heroId];
      if (!bp) continue;
      const b = bp.base;
      const a = bp.awakened;

      const wasDead = prev.dead;
      const oldName = prev.name;

      // —— 差值法（Q-C3 · A 方案）——
      // prev.atk/mnd/hp/maxHp 已包含：卡牌基线 + 境界+拜师增益 + 战中永久修正（如十万年魂骨献祭+5、万毒淬体-1）
      // 觉醒仅替换"卡牌基线"那一层，用差值法 = new = old + (awakened - base)，永久增益自然保留
      const atkDelta = a.atk - b.atk;
      const mndDelta = a.mnd - b.mnd;
      const hpCapDelta = a.hpCap - b.hpCap;
      const newMaxHp = prev.maxHp + hpCapDelta;          // 上限抬升，保留永久增益
      const newHp = newMaxHp;                            // 策略①：觉醒重置满血（但基于含增益的新上限）
      const newAtk = prev.atk + atkDelta;                // 保留战中永久增益/debuff
      const newMnd = prev.mnd + mndDelta;

      // 原子替换：保留 id/row/col/owner/acted 等上下文字段
      updated[idx] = {
        ...prev,
        name: a.name,
        type: a.type,
        hp: newHp,                                        // 含永久增益的满血
        maxHp: newMaxHp,                                  // 抬升后的上限
        atk: newAtk,
        mnd: newMnd,
        portrait: a.portrait ?? prev.portrait,
        // 技能替换：用觉醒的 battle_skill / ultimate
        // 注意：store 层 BattleUnit 的 battleSkill/ultimate 是 { name, desc } 对象
        battleSkill: prev.battleSkill, // 先保留，后面用 HERO_DATA 查
        ultimate: prev.ultimate,
        registrySkills: [...a.skills],
        awakened: true,
        form: 'awakened',
        dead: false, // 已退场也会复活（契约 Q25-B "复活到手牌区"，S7B 当前规则下直接复归原位）
        ultimateUsed: false, // 觉醒绝技重置为未使用
        // Q-C5 档位②：清控制类 debuff（觉醒突破仪式感），保留数值型永久修正（已在差值法里自然保留）
        immobilized: false,
        stunned: false,
        immobileNextTurn: false,
      };

      // 重建技能信息（从 heroesData 查觉醒形态的 battleSkill / ultimate）
      // 为避免循环依赖不直接引入 HEROES_DATA，只靠 SkillRegistry 提供的 description
      const bSkillId = a.skills[0];
      const ultSkillId = a.skills[1];
      const bReg = bSkillId ? SkillRegistry.get(bSkillId) : undefined;
      const ultReg = ultSkillId ? SkillRegistry.get(ultSkillId) : undefined;
      if (bReg) {
        updated[idx] = {
          ...updated[idx],
          battleSkill: { name: bReg.name, desc: bReg.description },
        };
      }
      if (ultReg) {
        updated[idx] = {
          ...updated[idx],
          ultimate: { name: ultReg.name, desc: ultReg.description },
        };
      }

      // —— 战报披露 ——
      get().addLog(
        `⚡觉醒！ ${oldName} → ${a.name}（气血=${newHp}/${newMaxHp} 修为=${newAtk} 心境=${newMnd}）${wasDead ? '【已退场觉醒：复归战场】' : ''}`,
        'system',
      );
    }

    set({ units: updated });
  },
}));
