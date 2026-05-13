/**
 * S7 战斗系统 Store — 合作清怪战
 * 4×10地图，2v6，8回合限制
 *
 * 【2026-05-09 阶段一重构】
 * 接入 SkillRegistry 新引擎（对齐 s7bBattleStore 模式），
 * 所有 112 条注册技能在 S7A 全部生效。
 * 劫匪保持静止不反击；Unit 结构向后兼容（新增 registrySkills / heroId 等）。
 */
import { create } from 'zustand';
import { asset } from '@/utils/assetPath';
import type { CultivationType } from '@/types/game';
import { SkillRegistry } from '@/systems/battle/skillRegistry';
import { findRegistryIdByName } from '@/data/skills_s7b';
import type {
  AttackContext,
  BattleUnit as EngineUnit,
  HookName,
  StatBox,
  Modifier as EngineModifier,
} from '@/systems/battle/types';
import {
  globalModStore,
  resetGlobalModStore,
  resolveStatSet,
  resolveStatDelta,
} from '@/systems/battle/e2Helpers';
import { cleanupAfterAttack, cleanupOnTurnStart, cleanupOnTurnEnd } from '@/systems/battle/modifierSystem';
import { applyDamagePipeline } from '@/systems/battle/damagePipeline';
import {
  shouldTryRevive,
  DEFAULT_REVIVE_PAYLOAD,
  reviveLogText,
} from '@/systems/battle/reviveCheck';
import {
  dispatchTurnStartHooks,
  dispatchTurnEndHooks,
  type TurnStartDispatchCtx,
} from '@/systems/battle/turnStartDispatcher';

/* ============ 技能名 → 注册id 反查 ============ */
function resolveSkillRegId(name: string | undefined | null): string | undefined {
  if (!name) return undefined;
  const autoId = SkillRegistry.findIdByName(name);
  if (autoId) return autoId;
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
  ultimateUsed: boolean;
  /** 主动战斗技能是否已使用（每场1次，用于藤化原·天鬼搜身等 isActive=true 的 battle_skill） */
  battleSkillUsed?: boolean;
  acted: boolean;
  stepsUsedThisTurn: number;
  attackedThisTurn: boolean;
  immobilized: boolean;
  stunned: boolean;
  dead: boolean;
  portrait: string;
  lastTerrain: TerrainType | null;
  /** 供新引擎使用的 registry id 列表 */
  registrySkills?: string[];
  /** 对应的主角 id */
  heroId?: string;
  /** 觉醒形态 */
  form?: 'base' | 'awakened';
  /** 是否已觉醒 */
  awakened?: boolean;
  /** 累计击杀数 */
  killCountByThisUnit?: number;
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
    result.push(Math.floor(Math.random() * 3));
  }
  return result;
}

function sum(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0);
}

function manhattan(r1: number, c1: number, r2: number, c2: number): number {
  return Math.abs(r1 - r2) + Math.abs(c1 - c2);
}

/** 把 store 的 BattleUnit 映射成新引擎的 EngineUnit */
function mapUnitToEngine(u: BattleUnit): EngineUnit {
  const mkBox = (n: number): StatBox => ({ base: n, current: n, initial: n });
  // ⚠ 关键修复（2026-05-10）：hp.initial 必须 = maxHp（开场满血），否则
  // 依赖"已损失气血"语义的技能（小舞儿八段摔·断魂、玄古天地等）会永远算出 0 伤害。
  // 同时 hp.base 也以 maxHp 为基线（最大上限），current 才是当前血量。
  const hpBox: StatBox = { base: u.maxHp, current: u.hp, initial: u.maxHp };
  // ⚠ 2026-05-12：让 atk.current / mnd.current 包含 stat_delta aura（古元天火阵 +1 等）
  //    过去直接 mkBox(u.atk) 导致 aura 完全哑火；现累加 globalModStore 中的 delta。
  const atkDelta = resolveStatDelta(u.id, 'atk').delta;
  const mndDelta = resolveStatDelta(u.id, 'mnd').delta;
  const atkBox: StatBox = { base: u.atk, current: Math.max(1, u.atk + atkDelta), initial: u.atk };
  const mndBox: StatBox = { base: u.mnd, current: Math.max(1, u.mnd + mndDelta), initial: u.mnd };
  return {
    id: u.id,
    name: u.name,
    type: u.type,
    owner: u.isEnemy ? 'P2' : 'P1',
    hp: hpBox,
    atk: atkBox,
    mnd: mndBox,
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
      extraActionsGranted: 0,
      extraActionsConsumed: 0,
    },
    portrait: u.portrait,
    ultimateUsed: u.ultimateUsed,
    killCount: u.killCountByThisUnit ?? 0,
  };
}

/**
 * 🔧 2026-05-12 修复：S7 剿匪场景的 turn-end hook 派发
 *
 * 问题根因：battleStore（S7 剿匪/S5a 试炼共用）在 endUnitTurn 时从未派发
 *           on_turn_end 钩子，导致以下 turn-end 类技能在剿匪场景全部失效：
 *             · 薰儿·古族血脉·共鸣（行动结束相邻友军回血）
 *             · 凤霓·残云、奥斯卡·香肠、藤化原·搜身扫描
 *             · 雪乃·古族驱散、塔莎·封印、唐雅·岚音、火雨皓·冰玉
 *             · 莫彩环·蓄力、牧沛玲·妙手、刘媚·清羽、药尘·冷火
 *             · 古元·古族天火阵 aura、留眉·清羽 等
 *
 * 修复：
 *   1) 提供 buildS7TurnHookCtx 让 dispatcher 能写回 store
 *   2) endUnitTurn 末尾调用 dispatchTurnEndHooks(unitId, ctx)
 *   3) 用 _s7TurnEndFiredThisRound 防止同回合重复触发（与 S7B 一致）
 *   4) startNewRound 时清空集合
 *
 * 【2026-05-12 增补】on_turn_start hook 派发：
 *   触发时机：玩家在 selectUnit 选中棋子瞬间（剿匪场景没有"轮到棋子"概念）
 *   _s7TurnStartFiredThisRound 保证同一棋子同一回合只触发一次（避免 selectUnit/cancelSelect 反复点击重复结算）
 *   受益技能（剿匪场景从此生效）：
 *     · 凝荣荣·七宝琉璃·加持（玩家可选 buff 友军）
 *     · 奥斯卡·香肠（行动开始为友军回血）
 *     · 谷鹤·聚元炉、晓阳觉醒·焚天、雅妃·补给、黎沐婉·清羽
 *     · 留眉·清思、田云子·命格、云雀子·窃元、亚菲·补给等共 12 个 turn-start 类
 */
let _s7TurnEndFiredThisRound = new Set<string>();
let _s7TurnStartFiredThisRound = new Set<string>();

function buildS7TurnHookCtx(
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
    // S7 剿匪暂不支持 turn-start 选择弹窗，留空即可（dispatcher 退化为旧 hook 自动逻辑）
  };
}

/* ============ 默认地图 4×10 ============ */
function createDefaultMap(): MapCell[][] {
  const map: MapCell[][] = [];
  for (let r = 0; r < 4; r++) {
    const row: MapCell[] = [];
    for (let c = 0; c < 10; c++) {
      row.push({ row: r, col: c, terrain: 'normal' });
    }
    map.push(row);
  }
  map[0][3] = { row: 0, col: 3, terrain: 'atk_boost' };
  map[3][6] = { row: 3, col: 6, terrain: 'atk_boost' };
  map[2][1] = { row: 2, col: 1, terrain: 'mnd_boost' };
  map[1][2] = { row: 1, col: 2, terrain: 'spring' };
  map[3][3] = { row: 3, col: 3, terrain: 'spring' };
  map[1][5] = { row: 1, col: 5, terrain: 'miasma' };
  map[3][4] = { row: 3, col: 4, terrain: 'miasma' };
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
  initialized: boolean;
  map: MapCell[][];
  units: BattleUnit[];
  round: number;
  maxRound: number;
  selectedUnitId: string | null;
  phase: ActionPhase;
  moveRange: Array<{ row: number; col: number }>;
  attackRange: Array<{ row: number; col: number }>;
  lastDice: DiceResult | null;
  killCount: number;
  logs: BattleLog[];
  skillUsedThisTurn: boolean;
  lastSkillEvent: { unitId: string; skillType: 'battle' | 'ultimate'; ts: number } | null;
  battleOver: boolean;
  battleResult: 'win' | 'lose' | 'timeout' | null;
  actionQueue: string[];
  actionIndex: number;

  /**
   * 玩家可控的复活分配弹窗（2026-05-11）
   * 当玩家方角色因徐立国"天罡元婴·重塑"复活时填入，UI 弹出 ReviveAllocateModal
   */
  pendingRevive: {
    unitId: string;
    unitName: string;
    current: { atk: number; mnd: number; hp: number };
  } | null;
  /** 玩家点确认 → 用新分配重写角色属性 */
  confirmReviveAllocate: (payload: { atk: number; mnd: number; hp: number }) => void;
  /** 玩家放弃调整 → 保持默认 */
  cancelReviveAllocate: () => void;

  initBattle: (
    heroUnit: Omit<BattleUnit, 'acted' | 'dead' | 'ultimateUsed' | 'immobilized' | 'stunned' | 'lastTerrain' | 'stepsUsedThisTurn' | 'attackedThisTurn'>,
    partnerUnit: Omit<BattleUnit, 'acted' | 'dead' | 'ultimateUsed' | 'immobilized' | 'stunned' | 'lastTerrain' | 'stepsUsedThisTurn' | 'attackedThisTurn'>,
  ) => void;
  selectUnit: (unitId: string) => void;
  cancelSelect: () => void;
  calcMoveRange: (unitId: string) => void;
  moveUnit: (unitId: string, toRow: number, toCol: number) => void;
  calcAttackRange: (unitId: string) => void;
  attack: (attackerId: string, defenderId: string, skillMod?: number) => DiceResult;
  useSkill: (unitId: string, skillType: 'battle' | 'ultimate') => void;
  performUltimate: (unitId: string, targetIds: string[], pickedPosition?: { row: number; col: number }) => boolean;
  ultimatePrecheck: (unitId: string) => { ok: boolean; reason?: string; candidateIds?: string[] };
  /** 主动战斗技能（2026-05-10 新增），用于 isActive=true 的 battle_skill（如藤化原·天鬼搜身） */
  performBattleSkillActive: (unitId: string, targetIds: string[]) => boolean;
  /** 主动战斗技能前置检查 */
  battleSkillPrecheck: (unitId: string) => { ok: boolean; reason?: string; candidateIds?: string[] };
  endUnitTurn: (unitId: string) => void;
  advanceAction: () => void;
  startNewRound: () => void;
  enemyCounterAttack: (enemyId: string) => DiceResult | null;
  processEnemyRound: () => void;
  addLog: (text: string, type: BattleLog['type']) => void;
  checkBattleEnd: () => boolean;
  getRewards: () => { stones: number; clues: number };
  reset: () => void;
  getCurrentActorId: () => string | null;
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
  lastSkillEvent: null as { unitId: string; skillType: 'battle' | 'ultimate'; ts: number } | null,
  battleOver: false,
  battleResult: null as 'win' | 'lose' | 'timeout' | null,
  actionQueue: [] as string[],
  actionIndex: 0,
  pendingRevive: null as BattleState['pendingRevive'],
};

export const useBattleStore = create<BattleState>((set, get) => ({
  ...initialState,

  initBattle: (heroUnit, partnerUnit) => {
    resetGlobalModStore();
    // 🔧 2026-05-12：清空跨场污染的 turn-end fired 标记
    _s7TurnEndFiredThisRound = new Set<string>();
    _s7TurnStartFiredThisRound = new Set<string>();
    const map = createDefaultMap();

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

    const playerUnits: BattleUnit[] = [
      {
        ...heroUnit,
        row: 0,
        col: 0,
        acted: false,
        dead: false,
        ultimateUsed: false,
        immobilized: false,
        stunned: false,
        lastTerrain: null,
        stepsUsedThisTurn: 0,
        attackedThisTurn: false,
        registrySkills: (heroUnit as { registrySkills?: string[] }).registrySkills ?? buildRegistrySkills(heroUnit),
        form: 'base',
        awakened: false,
        killCountByThisUnit: 0,
      },
      {
        ...partnerUnit,
        row: 1,
        col: 0,
        acted: false,
        dead: false,
        ultimateUsed: false,
        immobilized: false,
        stunned: false,
        lastTerrain: null,
        stepsUsedThisTurn: 0,
        attackedThisTurn: false,
        registrySkills: (partnerUnit as { registrySkills?: string[] }).registrySkills ?? buildRegistrySkills(partnerUnit),
        form: 'base',
        awakened: false,
        killCountByThisUnit: 0,
      },
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
      immobilized: true,
      stunned: false,
      portrait: asset('images/map/tile_enemy.png'),
      lastTerrain: null,
      stepsUsedThisTurn: 0,
      attackedThisTurn: false,
      registrySkills: [],
      form: 'base',
      awakened: false,
      killCountByThisUnit: 0,
    }));

    const allUnits = [...playerUnits, ...enemyUnits];

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
      lastSkillEvent: null,
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

    // 🔧 2026-05-12：派发 on_turn_start hook（剿匪场景）
    // 关键：凝荣荣七宝/奥斯卡香肠等 12 个 turn-start 类技能从此生效
    // 幂等：同一棋子同一回合只触发一次（避免反复 select/cancel 重复结算）
    if (!_s7TurnStartFiredThisRound.has(unitId)) {
      _s7TurnStartFiredThisRound.add(unitId);
      const ctx = buildS7TurnHookCtx(get, set);
      try {
        dispatchTurnStartHooks(unitId, ctx);
      } catch (e) {
        console.error('[battleStore] dispatchTurnStartHooks threw:', e);
      }
      // 🔧 2026-05-13：触发 turn-start cleanup（next_turn → this_turn）
      const cleanupEngine = {
        emit: (kind: string, _payload: any, narrative: string, opts?: { severity?: string }) => {
          if (opts?.severity !== 'debug') get().addLog(narrative, 'system');
          void kind;
        },
      } as any;
      cleanupOnTurnStart(globalModStore, unitId, cleanupEngine);
    }

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

    const remainingSteps = Math.max(0, unit.mnd - unit.stepsUsedThisTurn);
    if (remainingSteps <= 0) { set({ moveRange: [] }); return; }

    const range: Array<{ row: number; col: number }> = [];
    const visited = new Set<string>();
    const queue: Array<{ row: number; col: number; steps: number }> = [];
    const key = (r: number, c: number) => `${r},${c}`;

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

        if (map[nr][nc].terrain === 'obstacle') continue;
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

    // ★ 修复：路过瘴气格子不再立刻扣血/降三维。
    //   仅在 startNewRound 里检测"上回合末停留位置=瘴气" → 扣 1 点 hp。
    //   旧逻辑会在 movePath 时立扣 hp/atk/mnd 各 1，与"停留下回合扣"的设计不符。

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
    const { units } = get();
    const aIdx = units.findIndex((u) => u.id === attackerId);
    const dIdx = units.findIndex((u) => u.id === defenderId);
    if (aIdx === -1 || dIdx === -1) {
      return { attackerDice: [], defenderDice: [], attackerSum: 0, defenderSum: 0, skillMod: 0, counterMod: 0, damage: 0 };
    }

    const attacker = units[aIdx];
    const defender = units[dIdx];

    // 2026-05-12：骰数必须包含 stat_delta aura（古元天火阵/凝荣荣七宝加持/
    // 古元远古斗帝血脉、冰风万里 等 stat_delta modifier），之前直接读 u.atk
    // 导致所有 aura/群体 buff 技能哑火。
    const atkDeltaA = resolveStatDelta(attacker.id, 'atk').delta;
    const atkDeltaD = resolveStatDelta(defender.id, 'atk').delta;
    let diceAttack = Math.max(1, attacker.atk + atkDeltaA);
    let diceDefend = Math.max(0, defender.atk + atkDeltaD);

    const attackerSet = resolveStatSet(attacker.id, 'atk');
    if (attackerSet !== null) diceAttack = attackerSet;
    const defenderSet = resolveStatSet(defender.id, 'atk');
    if (defenderSet !== null) diceDefend = defenderSet;

    const calcLog: Array<{ source: string; delta: number; note: string }> = [];
    const hookFiredSet = new Set<string>();
    const engineLogs: BattleLog[] = [];
    const addEngineLog = (text: string, type: BattleLog['type'] = 'skill') => {
      engineLogs.push({ round: get().round, text, type });
    };

    let newAttacker = { ...attacker };
    let newDefender = { ...defender };

    const localEngine = {
      getUnit: (id: string) => {
        if (id === attacker.id) return mapUnitToEngine(newAttacker);
        if (id === defender.id) return mapUnitToEngine(newDefender);
        const u = units.find((x) => x.id === id);
        return u ? mapUnitToEngine(u) : undefined;
      },
      getAllUnits: () => units.map(mapUnitToEngine),
      getAlliesOf: (u: EngineUnit) => {
        const self = units.find((x) => x.id === u.id);
        if (!self) return [];
        return units.filter((x) => x.isEnemy === self.isEnemy && x.id !== self.id && !x.dead).map(mapUnitToEngine);
      },
      getEnemiesOf: (u: EngineUnit) => {
        const self = units.find((x) => x.id === u.id);
        if (!self) return [];
        return units.filter((x) => x.isEnemy !== self.isEnemy && !x.dead).map(mapUnitToEngine);
      },
      emit: (kind: string, _payload: any, narrative: string, opts?: { severity?: string }) => {
        if (opts?.severity === 'debug') return;
        const type: BattleLog['type'] =
          kind === 'damage_applied' ? 'damage'
          : kind === 'unit_leave' ? 'kill'
          : kind === 'skill_passive_trigger' || kind === 'skill_effect_applied' || kind === 'skill_effect_blocked'
            ? 'skill'
            : 'system';
        addEngineLog(narrative, type);
      },
      changeStat: (unitId: string, stat: 'hp' | 'atk' | 'mnd', delta: number, opts: {
        permanent: boolean;
        breakCap?: boolean;
        floor?: number;
        reason: string;
      }) => {
        // ★ 2026-05-10：hp 减少时走伤害管线（damage_redirect / damage_reduce / hp_floor）
        //   解决薰儿绝技【金帝天火阵】、【古族祖灵结界】等 modifier 不生效问题。
        if (stat === 'hp' && delta < 0) {
          const pipeline = applyDamagePipeline(
            {
              targetUnitId: unitId,
              damage: -delta,
              reason: opts.reason,
              currentHp: (() => {
                const t0 = unitId === attacker.id ? newAttacker : unitId === defender.id ? newDefender : null;
                return t0 ? t0.hp : 0;
              })(),
            },
            (uid) => {
              const t = uid === attacker.id ? newAttacker : uid === defender.id ? newDefender : units.find((x) => x.id === uid);
              return t ? t.hp : undefined;
            },
          );
          if (pipeline.redirected || pipeline.reducedBy > 0 || pipeline.hpFloorTriggered) {
            if (pipeline.redirected) {
              addEngineLog(`💫 伤害被重定向：${unitId} → ${pipeline.finalTargetId}`, 'skill');
            }
            if (pipeline.reducedBy > 0) {
              addEngineLog(`🛡 伤害被减免 ${pipeline.reducedBy} 点（${opts.reason}）`, 'skill');
            }
            if (pipeline.hpFloorTriggered) {
              addEngineLog(`✨ ${pipeline.finalTargetId} 触发 hp_floor 保护`, 'skill');
            }
          }
          // 切换到管线决定的最终目标 + 最终伤害
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
          target.hp = newVal;
          target.dead = newVal <= 0;
          if (opts.breakCap && newVal > target.maxHp) target.maxHp = newVal;
        }
        if (stat === 'atk') target.atk = newVal;
        if (stat === 'mnd') target.mnd = newVal;
        return newVal - oldVal;
      },
      attachModifier: (mod: any) => {
        globalModStore.attach(mod as EngineModifier);
        addEngineLog(`「${mod.sourceSkillId ?? '?'}」挂载修饰器`, 'system');
      },
      queryModifiers: (uid: string, k: any) => globalModStore.query(uid, k) as any,
      detachModifier: (mid: string) => { globalModStore.detach(mid); },
      fireHook: () => {},
      fireTurnHook: () => {},
      getRound: () => get().round,
      nextSeq: () => 0,
      getCurrentActorId: () => attacker.id,
      triggerAwakening: () => {},
    };

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

    const fireHooks = (unit: BattleUnit, hookName: HookName) => {
      const key = `${unit.id}::${hookName}`;
      if (hookFiredSet.has(key)) return;
      hookFiredSet.add(key);
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
          console.error('[s7a-hook]', hookName, skill.id, e);
        }
      }
      (ctx as any).__firingUnitId__ = undefined;
      (ctx as any).__firingUnitIsAttacker__ = undefined;
      diceAttack = ctx.diceAttack;
      diceDefend = ctx.diceDefend;
    };

    fireHooks(newAttacker, 'on_before_roll');
    fireHooks(newDefender, 'on_before_defend_roll');

    const aDice = rollDice(diceAttack);
    const dDice = rollDice(diceDefend);
    const aSum = sum(aDice);
    const dSum = sum(dDice);
    ctx.aSum = aSum; ctx.dSum = dSum;
    fireHooks(newAttacker, 'on_after_attack_roll');

    fireHooks(newDefender, 'on_before_being_attacked');

    fireHooks(newAttacker, 'on_damage_calc');
    fireHooks(newDefender, 'on_damage_calc');

    let damage = aSum - dSum;
    for (const entry of calcLog) {
      if (entry.source.endsWith('__multiplier__')) continue;
      if (entry.source.endsWith('__cap__')) continue;
      if (entry.source === '__final_damage__') continue;
      damage += entry.delta;
    }
    const counterMod = isCounter(attacker.type, defender.type) ? 1 : 0;
    if (counterMod) damage += counterMod;
    damage += skillMod;
    for (const entry of calcLog) {
      if (entry.source.endsWith('__multiplier__')) {
        damage = damage * entry.delta;
      }
    }
    for (const entry of calcLog) {
      if (entry.source.endsWith('__cap__')) {
        damage = Math.min(damage, entry.delta);
      }
    }
    damage = Math.max(1, damage);
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

    let newHp: number;
    let redirectedUnit: BattleUnit | null = null;
    let redirectedNewHp: number | null = null;
    if (realDefenderId === newDefender.id) {
      // 正常路径
      newHp = Math.max(0, newDefender.hp - realDamage);
      newDefender = { ...newDefender, hp: newHp, dead: newHp <= 0 };
    } else {
      // 重定向：原 defender 不扣血，伤害转给 redirectTarget
      newHp = newDefender.hp; // 原目标 hp 不变
      const rTarget = units.find((x) => x.id === realDefenderId);
      if (rTarget) {
        redirectedNewHp = Math.max(0, rTarget.hp - realDamage);
        redirectedUnit = { ...rTarget, hp: redirectedNewHp, dead: redirectedNewHp <= 0 };
      }
    }
    ctx.defender = mapUnitToEngine(newDefender);

    fireHooks(newDefender, 'on_after_being_hit');
    fireHooks(newAttacker, 'on_after_hit');

    const updated = [...units];
    updated[aIdx] = newAttacker;
    updated[dIdx] = newDefender;
    if (redirectedUnit) {
      const rIdx = updated.findIndex((x) => x.id === redirectedUnit!.id);
      if (rIdx >= 0) updated[rIdx] = redirectedUnit;
    }

    let killed = false;
    // 击杀判定：考虑重定向情况
    const finalVictim = redirectedUnit ?? newDefender;
    let finalVictimHp = redirectedNewHp ?? newHp;

    // ─────────────────────────────────────────────────────
    // 2026-05-11 复活机制：天罡元婴·重塑（徐立国）
    //   死亡瞬间检查：若该单位拥有 sr_xuliguo.ultimate 且未触发过 →
    //   原地复活（atk=3, mnd=2, hp=3，总数 8，本场限 1 次）
    // ─────────────────────────────────────────────────────
    if (finalVictimHp <= 0 && shouldTryRevive(finalVictim as any)) {
      const p = DEFAULT_REVIVE_PAYLOAD;
      const vIdx = updated.findIndex((x) => x.id === finalVictim.id);
      if (vIdx >= 0) {
        updated[vIdx] = {
          ...updated[vIdx],
          hp: p.hp,
          atk: p.atk,
          mnd: p.mnd,
          maxHp: Math.max(updated[vIdx].maxHp ?? p.hp, p.hp),
          dead: false,
          ultimateUsed: true,
        };
        finalVictimHp = p.hp;
        addEngineLog(reviveLogText(finalVictim.name, p, 'auto'), 'skill');
        // 玩家方：弹窗让玩家分配 8 点
        if (!finalVictim.isEnemy) {
          setTimeout(() => {
            const cur = get().pendingRevive;
            if (cur) return;
            set({
              pendingRevive: {
                unitId: finalVictim.id,
                unitName: finalVictim.name,
                current: { atk: p.atk, mnd: p.mnd, hp: p.hp },
              },
            });
          }, 200);
        }
      }
    }

    if (finalVictimHp <= 0) {
      killed = true;
      if (finalVictim.isEnemy) {
        set((s) => ({ killCount: s.killCount + 1 }));
      }
      if (finalVictim.isEnemy !== attacker.isEnemy) {
        newAttacker = {
          ...newAttacker,
          killCountByThisUnit: (newAttacker.killCountByThisUnit ?? 0) + 1,
        };
        updated[aIdx] = newAttacker;
      }
    }

    const result: DiceResult = { attackerDice: aDice, defenderDice: dDice, attackerSum: aSum, defenderSum: dSum, skillMod, counterMod, damage };

    const counterText = counterMod ? ' [克制+1]' : '';
    const skillText = skillMod ? ` [技能+${skillMod}]` : '';
    const bonusEntries = calcLog
      .filter((e) => !e.source.endsWith('__multiplier__') && e.source !== '__final_damage__')
      .filter((e) => !e.source.endsWith('__cap__'))
      .filter((e) => e.delta !== 0);
    const bonusText = bonusEntries.length ? ` [${bonusEntries.map((e) => e.note).join(' / ')}]` : '';
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
    for (const l of engineLogs) {
      get().addLog(l.text, l.type);
    }

    if (killed) {
      get().addLog(`💀 ${defender.name} 被击杀！`, 'kill');
    }

    // ★ Q4 修复：每次攻击后立即检测胜利条件——只要敌方全灭立刻结算，
    //   不再等所有玩家手动 endUnitTurn 才走 advanceAction → checkBattleEnd。
    get().checkBattleEnd();

    // 🔧 2026-05-13 修复：清理 this_attack 类 modifier（千刃雪天使圣剑等）
    //   引擎契约 §2.3 规定 this_attack modifier 必须在每次攻击末尾驱散，
    //   过去 store 层从未调用 cleanupAfterAttack，导致 atk +N 永久残留、
    //   骰子越攻越多（图示：4修为防方扔出9骰，9修为攻方扔出13骰）。
    {
      const cleanupEngine = {
        emit: (kind: string, _payload: any, narrative: string, opts?: { severity?: string }) => {
          if (opts?.severity !== 'debug') get().addLog(narrative, 'system');
          void kind;
        },
      } as any;
      cleanupAfterAttack(globalModStore, cleanupEngine);
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
      set({
        units: updated,
        skillUsedThisTurn: true,
        lastSkillEvent: { unitId, skillType: 'ultimate', ts: Date.now() },
      });
      get().addLog(`⚡ ${unit.name} 释放绝技【${unit.ultimate.name}】！`, 'skill');
    } else {
      if (!unit.battleSkill) return;
      set({
        skillUsedThisTurn: true,
        lastSkillEvent: { unitId, skillType: 'battle', ts: Date.now() },
      });
      get().addLog(`✨ ${unit.name} 使用技能【${unit.battleSkill.name}】`, 'skill');
    }
  },

  ultimatePrecheck: (unitId) => {
    const { units } = get();
    const u = units.find((x) => x.id === unitId);
    if (!u) return { ok: false, reason: '单位不存在' };
    if (!u.ultimate) return { ok: false, reason: '未装备绝技' };
    if (u.ultimateUsed) return { ok: false, reason: '绝技已使用' };

    const regId = resolveSkillRegId(u.ultimate.name);
    if (!regId) return { ok: true };
    const skill = SkillRegistry.get(regId);
    if (!skill) return { ok: true };
    if (!skill.precheck) return { ok: true };

    const adapter = {
      getEnemiesOf: (_s: any) => units.filter((x) => x.isEnemy !== u.isEnemy && !x.dead).map(mapUnitToEngine),
      getAlliesOf: (_s: any) => units.filter((x) => x.isEnemy === u.isEnemy && x.id !== u.id && !x.dead).map(mapUnitToEngine),
      getAllUnits: () => units.map(mapUnitToEngine),
      getUnit: (id: string) => { const x = units.find((v) => v.id === id); return x ? mapUnitToEngine(x) : undefined; },
    } as any;
    return skill.precheck(mapUnitToEngine(u), adapter);
  },

  performUltimate: (unitId, targetIds, pickedPosition) => {
    const { units } = get();
    const uIdx = units.findIndex((x) => x.id === unitId);
    if (uIdx < 0) return false;
    const u = units[uIdx];
    if (!u.ultimate || u.ultimateUsed) return false;

    const regId = resolveSkillRegId(u.ultimate.name);
    if (!regId) {
      const updated = [...units];
      updated[uIdx] = { ...u, ultimateUsed: true };
      set({ units: updated, skillUsedThisTurn: true });
      get().addLog(`⚡ ${u.name} 释放绝技【${u.ultimate.name}】！（效果待实装）`, 'skill');
      return true;
    }
    const skill = SkillRegistry.get(regId);
    if (!skill || !skill.isActive || !skill.activeCast) {
      const updated = [...units];
      updated[uIdx] = { ...u, ultimateUsed: true };
      set({ units: updated, skillUsedThisTurn: true });
      get().addLog(`⚡ ${u.name} 释放绝技【${u.ultimate.name}】！`, 'skill');
      return true;
    }

    const snapshots: Record<string, BattleUnit> = {};
    for (const x of units) snapshots[x.id] = { ...x };

    const engineLogs: BattleLog[] = [];
    const addEngineLog = (text: string, type: BattleLog['type'] = 'skill') => {
      engineLogs.push({ round: get().round, text, type });
    };

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
        if (opts?.severity === 'debug') return;
        const type: BattleLog['type'] =
          kind === 'damage_applied' ? 'damage'
          : kind === 'unit_leave' ? 'kill'
          : kind === 'skill_active_cast' || kind === 'skill_passive_trigger' ||
            kind === 'skill_effect_applied' || kind === 'skill_effect_blocked'
            ? 'skill'
            : 'system';
        addEngineLog(narrative, type);
      },
      changeStat: (id: string, stat: 'hp' | 'atk' | 'mnd', delta: number, opts: {
        permanent: boolean; breakCap?: boolean; floor?: number; reason: string;
      }) => {
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

    let precheckCandidateIds: string[] = [];
    if (skill.precheck) {
      const pre = skill.precheck(mapUnitToEngine(u), adapter);
      if (!pre.ok) {
        get().addLog(`⚠️ ${pre.reason ?? '绝技发动失败'}`, 'skill');
        return false;
      }
      precheckCandidateIds = pre.candidateIds ?? [];
    }

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

    const castResult = skill.activeCast!(mapUnitToEngine(u), effectiveTargetIds, adapter);
    if (!castResult.consumed) return false;

    if (snapshots[u.id]) {
      snapshots[u.id].ultimateUsed = true;
    }

    // —— 对于"每段独立结算"的攻击型绝技 —— 2026-05-11 架构升级
    // 从硬编码白名单改为读取技能注册表的 skill.followUpAttack 字段
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
              fua.diceOverride!({ atk: { current: self.atk } } as any)
          : undefined,
        postHit: fua.postHit
          ? (target: BattleUnit) => {
              fua.postHit!(target as any, (text: string) => addEngineLog(text, 'skill'));
            }
          : undefined,
      };
    }

    const afterCastUnits = units.map((x) => snapshots[x.id] ?? x);

    // ★ 修复：通过对比 cast 前后的死亡状态，统计本次绝技直接造成的敌方死亡数
    //   原因：很多绝技（如旺林·逆·天地崩）直接通过 engine.changeStat 把敌人 hp 改为 0，
    //         不走 attack() 的击杀累加逻辑 → 导致 S7A 结算时 killCount=0、奖励错误。
    //   方案：在 set 之前 diff，新增死亡的敌方 → killCount++ 并累加到施法者 killCountByThisUnit。
    let killedByCast = 0;
    const castAttackerWasEnemy = u.isEnemy;
    for (let i = 0; i < units.length; i++) {
      const before = units[i];
      const after = afterCastUnits[i];
      if (!before || !after) continue;
      const newlyDead = !before.dead && after.dead;
      if (!newlyDead) continue;
      // 仅统计"敌对阵营"的击杀（avoid 自损算成击杀自己）
      if (after.isEnemy !== castAttackerWasEnemy) {
        killedByCast++;
      }
    }
    if (killedByCast > 0) {
      set((s) => ({ killCount: s.killCount + killedByCast }));
      // 同步累加到施法者的 killCountByThisUnit（影响"杀敌-1需要X"等被动）
      const aIdx2 = afterCastUnits.findIndex((x) => x.id === unitId);
      if (aIdx2 >= 0 && afterCastUnits[aIdx2]) {
        afterCastUnits[aIdx2] = {
          ...afterCastUnits[aIdx2],
          killCountByThisUnit: (afterCastUnits[aIdx2].killCountByThisUnit ?? 0) + killedByCast,
        };
      }
    }

    set({
      units: afterCastUnits,
      skillUsedThisTurn: true,
      lastSkillEvent: { unitId, skillType: 'ultimate', ts: Date.now() },
    });
    get().addLog(`⚡ ${u.name} 释放绝技【${u.ultimate.name}】！`, 'skill');
    for (const l of engineLogs) get().addLog(l.text, l.type);

    // ═══ P2 · C 类位置选绝技：小战祖树盾 —— 在 pickedPosition 位置放置永久障碍 ═══
    if (regId === 'bsr_xiaozhan.ult' && pickedPosition) {
      const { row: pr, col: pc } = pickedPosition;
      const curMap = get().map;
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
        // 障碍物落地后，立刻刷新当前选中单位的可移动/可攻击范围
        const sel = get().selectedUnitId;
        if (sel) {
          setTimeout(() => {
            useBattleStore.getState().calcMoveRange(sel);
            useBattleStore.getState().calcAttackRange(sel);
          }, 0);
        }
      } else {
        const reason = !inBoard ? '越界' : !notObstacle ? '该位置已是障碍' : '该位置已被角色占据';
        get().addLog(`🌳 萧族护盾落点不合法（${reason}）`, 'system');
        console.warn('[xiaozhan_zushudun] 落点失败', { pr, pc, inBoard, notObstacle, unoccupied });
      }
    } else if (regId === 'bsr_xiaozhan.ult' && !pickedPosition) {
      get().addLog(`⚠️ 萧族护盾未指定落点，请先点击棋盘空格子选择位置`, 'system');
      console.warn('[xiaozhan_zushudun S7] performUltimate 未传 pickedPosition');
    }

    // 输出击杀日志，让玩家看到结果
    if (killedByCast > 0) {
      for (let i = 0; i < units.length; i++) {
        const before = units[i];
        const after = afterCastUnits[i];
        if (before && after && !before.dead && after.dead && after.isEnemy !== castAttackerWasEnemy) {
          get().addLog(`💀 ${after.name} 被【${u.ultimate.name}】击杀！`, 'kill');
        }
      }
    }

    const multi = multiSegmentSkills[regId];
    if (multi) {
      for (const tid of multi.targets) {
        const curUnits = get().units;
        const target = curUnits.find((x) => x.id === tid);
        const attackerCur = curUnits.find((x) => x.id === unitId);
        if (!target || target.dead || !attackerCur) continue;

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

        if (restoreAtk !== null) {
          const us = [...get().units];
          const ai = us.findIndex((x) => x.id === unitId);
          us[ai] = { ...us[ai], atk: restoreAtk };
          set({ units: us });
        }

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

    // ★ Q4 修复：绝技释放后也立刻检测胜利（旺林天地崩、千仞雪天使圣剑等都在这里收尾）
    get().checkBattleEnd();

    return true;
  },

  /* ═════════════════════════════════════════════════════════════ */
  /*  主动战斗技能（2026-05-10 新增 / 藤化原天鬼搜身等）             */
  /* ═════════════════════════════════════════════════════════════ */
  battleSkillPrecheck: (unitId) => {
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
      getEnemiesOf: (_s: any) => units.filter((x) => x.isEnemy !== u.isEnemy && !x.dead).map(mapUnitToEngine),
      getAlliesOf: (_s: any) => units.filter((x) => x.isEnemy === u.isEnemy && x.id !== u.id && !x.dead).map(mapUnitToEngine),
      getAllUnits: () => units.filter((x) => !x.dead).map(mapUnitToEngine),
      getUnit: (id: string) => { const x = units.find((v) => v.id === id); return x ? mapUnitToEngine(x) : undefined; },
    } as any;
    return skill.precheck(mapUnitToEngine(u), adapter);
  },

  performBattleSkillActive: (unitId, targetIds) => {
    const { units } = get();
    const uIdx = units.findIndex((x) => x.id === unitId);
    if (uIdx < 0) return false;
    const u = units[uIdx];
    if (!u.battleSkill || u.battleSkillUsed) return false;

    const regId = resolveSkillRegId(u.battleSkill.name);
    if (!regId) return false;
    const skill = SkillRegistry.get(regId);
    if (!skill || !skill.isActive || !skill.activeCast) return false;

    // 适配器 —— 仅日志收集 + 查询
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
        const type: BattleLog['type'] = kind === 'skill_active_cast' ? 'skill' : 'system';
        if (opts?.severity !== 'debug') addEngineLog(narrative, type);
      },
      changeStat: () => 0,
      // 🔧 2026-05-12：让主动战技 activeCast 挂的 modifier 落到全局 store
      attachModifier: (mod: any) => {
        globalModStore.attach(mod as EngineModifier);
        addEngineLog(`「${mod.sourceSkillId ?? '?'}」挂载修饰器`, 'system');
      },
      queryModifiers: (uid: string, k: any) => globalModStore.query(uid, k) as any,
      detachModifier: (mid: string) => globalModStore.detach(mid),
      fireHook: () => {},
      fireTurnHook: () => {},
      getRound: () => get().round,
      nextSeq: () => 0,
      getCurrentActorId: () => unitId,
      triggerAwakening: () => {},
    } as any;

    if (skill.precheck) {
      const pre = skill.precheck(mapUnitToEngine(u), adapter);
      if (!pre.ok) {
        get().addLog(`⚠️ ${pre.reason ?? '战斗技能发动失败'}`, 'skill');
        return false;
      }
    }

    const result = skill.activeCast(mapUnitToEngine(u), targetIds, adapter);
    if (!result.consumed) return false;

    // store 层执行实际效果（按 regId 路由）
    if (regId === 'sr_tenghuayuan.battle') {
      const targetId = targetIds[0];
      const cur = get().units;
      const si = cur.findIndex((x) => x.id === unitId);
      const ti = cur.findIndex((x) => x.id === targetId);
      if (si < 0 || ti < 0) return false;
      const us = [...cur];
      const sRow = us[si].row, sCol = us[si].col;
      us[si] = { ...us[si], row: us[ti].row, col: us[ti].col, battleSkillUsed: true };
      us[ti] = { ...us[ti], row: sRow, col: sCol };
      set({ units: us });
    } else {
      const us = [...get().units];
      const si = us.findIndex((x) => x.id === unitId);
      if (si >= 0) {
        us[si] = { ...us[si], battleSkillUsed: true };
      }
      set({ units: us });
    }

    for (const l of engineLogs) get().addLog(l.text, l.type);
    return true;
  },

  endUnitTurn: (unitId) => {
    const { units, map } = get();
    const idx = units.findIndex((u) => u.id === unitId);
    if (idx === -1) return;
    const u = units[idx];
    if (u.acted) return; // 🔒 幂等：已结束的回合不重复处理（普攻后 store 自动调 + screen 关骰子也会调）
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

    // 🔧 2026-05-12 修复：S7 剿匪场景接入 on_turn_end hook 派发
    // 关键：薰儿·古族血脉·共鸣 + 11 个 turn-end 类技能在剿匪场景从此生效
    if (!_s7TurnEndFiredThisRound.has(unitId)) {
      _s7TurnEndFiredThisRound.add(unitId);
      const ctx = buildS7TurnHookCtx(get, set);
      try {
        dispatchTurnEndHooks(unitId, ctx);
      } catch (e) {
        console.error('[battleStore] dispatchTurnEndHooks threw:', e);
      }
      // 🔧 2026-05-13：清理 this_turn 类 modifier（属本单位的）
      const cleanupEngine = {
        emit: (kind: string, _payload: any, narrative: string, opts?: { severity?: string }) => {
          if (opts?.severity !== 'debug') get().addLog(narrative, 'system');
          void kind;
        },
      } as any;
      cleanupOnTurnEnd(globalModStore, unitId, cleanupEngine);
    }
  },

  advanceAction: () => {
    const state = get();
    if (state.battleOver) return;

    const playerUnits = state.units.filter((u) => !u.isEnemy && !u.dead);
    const allActed = playerUnits.every((u) => u.acted);

    if (allActed) {
      if (get().checkBattleEnd()) return;
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

    // 🔧 2026-05-12：清空上回合的 turn-end fired 集合，新回合允许重新触发
    _s7TurnEndFiredThisRound = new Set<string>();
    _s7TurnStartFiredThisRound = new Set<string>();

    get().addLog(`── 第 ${newRound} 回合开始 ──`, 'system');

    const updated = units.map((u) => {
      if (u.dead) return u;
      const terrain = map[u.row]?.[u.col]?.terrain;
      let newU = {
        ...u,
        acted: false,
        immobilized: u.isEnemy ? u.immobilized : false,
        stunned: false,
        stepsUsedThisTurn: 0,
        attackedThisTurn: false,
      };

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

      if (terrain === 'miasma') {
        const newHp = Math.max(0, newU.hp - 1);
        newU = { ...newU, hp: newHp, dead: newHp <= 0 };
        get().addLog(`☠ ${u.name} 停留在魔气侵蚀区，额外受到1点环境伤害`, 'damage');
        if (newHp <= 0) {
          get().addLog(`💀 ${u.name} 因持续瘴气而倒下！`, 'kill');
        }
      }

      newU.lastTerrain = terrain ?? null;

      return newU;
    });

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

    const adjacentPlayers = units.filter((u) =>
      !u.isEnemy && !u.dead && manhattan(enemy.row, enemy.col, u.row, u.col) === 1,
    );
    if (adjacentPlayers.length === 0) return null;

    const target = adjacentPlayers[Math.floor(Math.random() * adjacentPlayers.length)];
    get().addLog(`🔄 ${enemy.name} 反击 ${target.name}`, 'action');
    return get().attack(enemyId, target.id);
  },

  processEnemyRound: () => {
    // A方案：劫匪完全静止不反击
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
    if (killCount === 0) return { stones: 0, clues: 0 };
    if (killCount <= 2) return { stones: 15, clues: 1 };
    if (killCount <= 4) return { stones: 22, clues: 2 };
    return { stones: 30, clues: 3 };
  },

  reset: () => set(initialState),

  confirmReviveAllocate: (payload) => {
    const pending = get().pendingRevive;
    if (!pending) return;
    if (payload.atk + payload.mnd + payload.hp !== 8) {
      set({ pendingRevive: null });
      return;
    }
    const us = [...get().units];
    const i = us.findIndex((u) => u.id === pending.unitId);
    if (i >= 0) {
      us[i] = {
        ...us[i],
        atk: payload.atk,
        mnd: payload.mnd,
        hp: payload.hp,
        maxHp: Math.max(us[i].maxHp ?? payload.hp, payload.hp),
      };
      set({ units: us });
      get().addLog(
        `✨ 天罡元婴·重塑：${pending.unitName} 重新分配 → 修为 ${payload.atk} / 心境 ${payload.mnd} / 气血 ${payload.hp}`,
        'skill',
      );
    }
    set({ pendingRevive: null });
  },
  cancelReviveAllocate: () => {
    const pending = get().pendingRevive;
    if (!pending) return;
    get().addLog(
      `📜 玩家保持默认复活分配（修为 ${pending.current.atk} / 心境 ${pending.current.mnd} / 气血 ${pending.current.hp}）`,
      'system',
    );
    set({ pendingRevive: null });
  },

  getCurrentActorId: () => {
    const { units, actionQueue } = get();
    for (const id of actionQueue) {
      const u = units.find((x) => x.id === id);
      if (u && !u.acted && !u.dead) return id;
    }
    return null;
  },

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
    // ★ 修复：单步 moveOneStep 同样不在路过时扣血，统一由 startNewRound 处理"停留扣血"
    set({ units: updated });
  },
}));
