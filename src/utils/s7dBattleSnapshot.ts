/**
 * S7D · 战斗完整状态快照导出工具
 *
 * ───────────────────────────────────────────────────────────────────────────
 *  动机
 * ───────────────────────────────────────────────────────────────────────────
 *  S7D 战斗的文字 log（state.log[]）只反映"已经发生了什么"的人类可读叙述，
 *  对于定位"棋子缺失行动轮次"这类系统性 bug 远远不够。
 *
 *  当 bug 发生时，定位真因需要的是**当下引擎内部的完整状态**：
 *    1) 6 玩家的 fieldSlots / instanceIds / mindFrozen / alive
 *    2) 全部单位的运行时数值（hp/atk/mnd/zone/position/fieldSlot/awakened/各种 thisTurn 标记）
 *    3) actionQueue 当前快照（"队列里有谁、谁还没行动"）
 *    4) reinforceQueue 当前快照（"是否漏了补位任务、有没有卡死的补位"）
 *    5) 双方水晶 + 每回合扣血记录
 *    6) 全局 modifierStore 当下挂着的 modifier 列表（disable_move / damage_cap 等）
 *    7) phase / bigRound / subRound / currentActorIdx / winner / endReason
 *    8) dynamicObstacles
 *    9) 文字战报 log[]（保留以便人类对照）
 *
 *  这些信息合在一起足以让开发者离线复盘任意一帧战场状态。
 *
 * ───────────────────────────────────────────────────────────────────────────
 *  使用
 * ───────────────────────────────────────────────────────────────────────────
 *  在战报面板点击 "📥 导出 JSON" 按钮 →
 *    生成文件 s7d_battle_<battleId>_R<bigRound>_S<subRound>_<yyyymmddhhmmss>.json
 */

import type { S7DBattleState, BattleCardInstance } from '@/types/s7dBattle';
import { globalModStore } from '@/systems/battle/e2Helpers';
import type { Modifier } from '@/systems/battle/types';

/** Schema 版本号；后续若快照结构有不兼容变更，递增此值 */
export const S7D_SNAPSHOT_SCHEMA = 1;

/** 完整快照对象的类型 */
export interface S7DBattleSnapshot {
  __schema: number;
  exportedAt: string; // ISO 时间
  exportedAtLocal: string; // 本地可读时间（北京时区文案）

  // 元信息
  battleId: string;
  playerHeroId: string;
  playerFaction: 'A' | 'B';

  // 回合系统
  bigRound: number;
  bigRoundMax: number;
  subRound: 1 | 2;
  phase: string;
  currentActorIdx: number;

  // 胜负
  winner: 'A' | 'B' | 'draw' | null;
  endReason: string | null;

  // 6 玩家
  players: Array<{
    ownerId: string;
    isHuman: boolean;
    heroId: string;
    heroName: string;
    faction: 'A' | 'B';
    mindFrozen: number;
    instanceIds: string[];
    fieldSlots: { slot1: string | undefined; slot2: string | undefined };
    alive: boolean;
    /** 派生字段（导出时计算，方便阅读） */
    derived: {
      handCount: number;
      graveCount: number;
      fieldCount: number;
      slot1Empty: boolean;
      slot2Empty: boolean;
    };
  }>;

  // 单位（按 ownerId/instanceId 索引）
  units: Record<string, BattleUnitSnapshot>;

  // 行动队列
  actionQueue: Array<{
    instanceId: string;
    ownerId: string;
    mindFrozen: number;
    fieldSlot: 1 | 2;
    acted: boolean;
    skipped: boolean;
  }>;

  // 补位队列
  reinforceQueue: Array<{
    ownerId: string;
    slot: 1 | 2;
    candidateInstanceIds: string[];
    reason: string;
  }>;

  // 水晶
  crystalA: CrystalSnapshot;
  crystalB: CrystalSnapshot;

  // 动态障碍
  dynamicObstacles: string[];

  // 全局 Modifier
  modifiers: ModifierSnapshot[];

  // 文字战报（与 store 中的 log 一致）
  log: Array<{
    seq: number;
    bigRound: number;
    subRound?: 1 | 2;
    kind: string;
    text: string;
    actorId?: string;
    targetIds?: string[];
    payload?: unknown;
  }>;

  // 统计：按 ownerId 聚合在每个大回合是否有过行动队列项（最关键的诊断信息）
  diagnostics: DiagnosticsBundle;
}

interface BattleUnitSnapshot {
  instanceId: string;
  cardId: string;
  name: string;
  type: string;
  rarity: string;
  ownerId: string;
  faction: 'A' | 'B';
  isHero: boolean;
  heroId?: string;

  hp: number;
  hpMax: number;
  hpInitial: number;
  atk: number;
  atkInitial: number;
  mnd: number;
  mndInitial: number;

  zone: 'field' | 'hand' | 'grave';
  position?: { row: number; col: number };
  fieldSlot?: 1 | 2;
  deployedAtRound?: number;
  deadAtBigRound?: number;
  deadAtSubRound?: 1 | 2;

  // 行为标记
  immobilized: boolean;
  stunned: boolean;
  hasMovedThisTurn: boolean;
  hasActedThisTurn: boolean;
  stepsUsedThisTurn: number;
  attackedThisTurn: boolean;
  skillUsedThisTurn: boolean;

  // 觉醒 / 击杀
  awakened: boolean;
  form: 'base' | 'awakened';
  killCount: number;
  ultimateUsed: boolean;

  // 红蝶蛊惑
  charmedNextTurn?: boolean;

  // 上回合地形
  lastTerrain?: string | null;

  // 技能元数据
  registrySkills: string[];
  ultimateId?: string;
  battleSkillId?: string;
  battleSkillName?: string;
  ultimateName?: string;
}

interface CrystalSnapshot {
  faction: 'A' | 'B';
  positions: Array<{ row: number; col: number }>;
  hp: number;
  hpMax: number;
  damageLog: Array<{
    bigRound: number;
    occupants: Array<{ instanceId: string; ownerId: string; pos: { row: number; col: number } }>;
    damage: number;
  }>;
}

interface ModifierSnapshot {
  id: string;
  kind: string;
  category: string;
  sourceSkillId: string;
  sourceUnitId: string;
  targetUnitId: string;
  targetUnitName?: string;
  payload: Record<string, unknown>;
  duration: unknown;
  priority: number;
}

interface DiagnosticsBundle {
  /** 每个 owner 在 log 里出现过的 (bigRound, subRound) 集合（基于 actor_id 出现的 turn_start log） */
  actorActivityByOwner: Record<
    string,
    Array<{ round: number; sub: 1 | 2 }>
  >;
  /** 每个 owner 当前是否有任意一槽为空 */
  playersWithEmptySlot: string[];
  /** 当前不在场（zone≠field）但 hp>0 的单位（应该会被补位调度的候选） */
  benchAlive: Array<{ ownerId: string; instanceId: string; name: string; hp: number; zone: string }>;
  /** 当前 hp<=0 但 zone=field 的"半死"单位（reconcileDeadUnits 漏网） */
  halfDeadInField: Array<{ ownerId: string; instanceId: string; name: string; hp: number }>;
  /** 当前 zone=grave 但仍有 fieldSlot/position 的"残留死尸"单位 */
  graveWithSlotResidue: Array<{ ownerId: string; instanceId: string; name: string; fieldSlot?: 1 | 2 }>;
  /** 在战报里完全没出现 turn_start 的 (owner, round, sub) 三元组 */
  silentSkips: Array<{ ownerId: string; round: number; sub: 1 | 2 }>;
}

// ──────────────────────────────────────────────────────────────────────────
// 主入口
// ──────────────────────────────────────────────────────────────────────────

/**
 * 把 zustand store 内的 S7DBattleState 整理成可序列化、便于离线复盘的快照
 */
export function buildS7DBattleSnapshot(state: S7DBattleState): S7DBattleSnapshot {
  const now = new Date();

  // ── 单位
  const units: Record<string, BattleUnitSnapshot> = {};
  for (const [id, u] of Object.entries(state.units)) {
    units[id] = mapUnit(u);
  }

  // ── 玩家（含派生字段）
  const players = state.players.map((p) => {
    const handCount = p.instanceIds.filter((id) => state.units[id]?.zone === 'hand').length;
    const graveCount = p.instanceIds.filter((id) => state.units[id]?.zone === 'grave').length;
    const fieldCount = p.instanceIds.filter((id) => state.units[id]?.zone === 'field').length;
    return {
      ownerId: p.ownerId,
      isHuman: p.isHuman,
      heroId: p.heroId,
      heroName: p.heroName,
      faction: p.faction,
      mindFrozen: p.mindFrozen,
      instanceIds: p.instanceIds.slice(),
      fieldSlots: { slot1: p.fieldSlots.slot1, slot2: p.fieldSlots.slot2 },
      alive: p.alive,
      derived: {
        handCount,
        graveCount,
        fieldCount,
        slot1Empty: p.fieldSlots.slot1 === undefined,
        slot2Empty: p.fieldSlots.slot2 === undefined,
      },
    };
  });

  // ── 全局 modifier
  const modifiers: ModifierSnapshot[] = [];
  globalModStore.forEach((m: Modifier) => {
    const target = state.units[m.targetUnitId];
    modifiers.push({
      id: m.id,
      kind: m.kind,
      category: m.category,
      sourceSkillId: m.sourceSkillId,
      sourceUnitId: m.sourceUnitId,
      targetUnitId: m.targetUnitId,
      targetUnitName: target?.name,
      payload: { ...(m.payload || {}) },
      duration: { ...m.duration },
      priority: m.priority,
    });
  });

  // ── 诊断
  const diagnostics = buildDiagnostics(state);

  return {
    __schema: S7D_SNAPSHOT_SCHEMA,
    exportedAt: now.toISOString(),
    exportedAtLocal: formatLocal(now),
    battleId: state.battleId,
    playerHeroId: state.playerHeroId,
    playerFaction: state.playerFaction,
    bigRound: state.bigRound,
    bigRoundMax: state.bigRoundMax,
    subRound: state.subRound,
    phase: state.phase,
    currentActorIdx: state.currentActorIdx,
    winner: state.winner,
    endReason: state.endReason,
    players,
    units,
    actionQueue: state.actionQueue.map((a) => ({
      instanceId: a.instanceId,
      ownerId: a.ownerId,
      mindFrozen: a.mindFrozen,
      fieldSlot: a.fieldSlot,
      acted: a.acted,
      skipped: a.skipped,
    })),
    reinforceQueue: state.reinforceQueue.map((r) => ({
      ownerId: r.ownerId,
      slot: r.slot,
      candidateInstanceIds: r.candidateInstanceIds.slice(),
      reason: r.reason,
    })),
    crystalA: mapCrystal(state.crystalA),
    crystalB: mapCrystal(state.crystalB),
    dynamicObstacles: (state.dynamicObstacles ?? []).slice(),
    modifiers,
    log: state.log.map((l) => ({
      seq: l.seq,
      bigRound: l.bigRound,
      subRound: l.subRound,
      kind: l.kind,
      text: l.text,
      actorId: l.actorId,
      targetIds: l.targetIds ? l.targetIds.slice() : undefined,
      payload: l.payload,
    })),
    diagnostics,
  };
}

/**
 * 把快照保存为浏览器下载文件
 */
export function downloadS7DBattleSnapshot(state: S7DBattleState): string {
  const snap = buildS7DBattleSnapshot(state);
  const text = JSON.stringify(snap, null, 2);
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const stamp = compactStamp(new Date());
  const filename = `s7d_battle_${state.battleId || 'unknown'}_R${state.bigRound}_S${state.subRound}_${stamp}.json`;

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 释放 blob URL
  setTimeout(() => URL.revokeObjectURL(url), 5000);

  return filename;
}

// ──────────────────────────────────────────────────────────────────────────
// 内部工具
// ──────────────────────────────────────────────────────────────────────────

function mapUnit(u: BattleCardInstance): BattleUnitSnapshot {
  return {
    instanceId: u.instanceId,
    cardId: u.cardId,
    name: u.name,
    type: u.type,
    rarity: u.rarity,
    ownerId: u.ownerId,
    faction: u.faction,
    isHero: u.isHero,
    heroId: u.heroId,

    hp: u.hp,
    hpMax: u.hpMax,
    hpInitial: u.hpInitial,
    atk: u.atk,
    atkInitial: u.atkInitial,
    mnd: u.mnd,
    mndInitial: u.mndInitial,

    zone: u.zone,
    position: u.position ? { row: u.position.row, col: u.position.col } : undefined,
    fieldSlot: u.fieldSlot,
    deployedAtRound: u.deployedAtRound,
    deadAtBigRound: u.deadAtBigRound,
    deadAtSubRound: u.deadAtSubRound,

    immobilized: u.immobilized,
    stunned: u.stunned,
    hasMovedThisTurn: u.hasMovedThisTurn,
    hasActedThisTurn: u.hasActedThisTurn,
    stepsUsedThisTurn: u.stepsUsedThisTurn,
    attackedThisTurn: u.attackedThisTurn,
    skillUsedThisTurn: u.skillUsedThisTurn,

    awakened: u.awakened,
    form: u.form,
    killCount: u.killCount,
    ultimateUsed: u.ultimateUsed,

    charmedNextTurn: u.charmedNextTurn,
    lastTerrain: u.lastTerrain,

    registrySkills: u.registrySkills.slice(),
    ultimateId: u.ultimateId,
    battleSkillId: u.battleSkillId,
    battleSkillName: u.battleSkill?.name,
    ultimateName: u.ultimate?.name,
  };
}

function mapCrystal(c: S7DBattleState['crystalA']): CrystalSnapshot {
  return {
    faction: c.faction,
    positions: c.positions.map((p) => ({ row: p.row, col: p.col })),
    hp: c.hp,
    hpMax: c.hpMax,
    damageLog: c.damageLog.map((d) => ({
      bigRound: d.bigRound,
      occupants: d.occupants.map((o) => ({
        instanceId: o.instanceId,
        ownerId: o.ownerId,
        pos: { row: o.pos.row, col: o.pos.col },
      })),
      damage: d.damage,
    })),
  };
}

/**
 * 诊断包：自动从战报 + 当前状态扫出所有"行动轮次缺失"的可疑情况
 */
function buildDiagnostics(state: S7DBattleState): DiagnosticsBundle {
  // 1. 每个 owner 在哪些 (round, sub) 出现过 turn_start
  const actorActivityByOwner: Record<string, Array<{ round: number; sub: 1 | 2 }>> = {};
  for (const p of state.players) {
    actorActivityByOwner[p.ownerId] = [];
  }
  for (const entry of state.log) {
    if (entry.kind !== 'turn_start') continue;
    if (!entry.actorId) continue;
    const u = state.units[entry.actorId];
    if (!u) continue;
    const sub = (entry.subRound ?? 1) as 1 | 2;
    const list = actorActivityByOwner[u.ownerId];
    if (!list) continue;
    // 去重
    if (!list.some((it) => it.round === entry.bigRound && it.sub === sub)) {
      list.push({ round: entry.bigRound, sub });
    }
  }

  // 2. 当前哪些玩家有空槽
  const playersWithEmptySlot: string[] = [];
  for (const p of state.players) {
    if (p.fieldSlots.slot1 === undefined || p.fieldSlots.slot2 === undefined) {
      playersWithEmptySlot.push(p.ownerId);
    }
  }

  // 3. 当前 zone≠field 但 hp>0 的单位
  const benchAlive: DiagnosticsBundle['benchAlive'] = [];
  for (const u of Object.values(state.units)) {
    if (u.zone !== 'field' && u.hp > 0) {
      benchAlive.push({
        ownerId: u.ownerId,
        instanceId: u.instanceId,
        name: u.name,
        hp: u.hp,
        zone: u.zone,
      });
    }
  }

  // 4. hp<=0 但 zone=field 的"半死"单位
  const halfDeadInField: DiagnosticsBundle['halfDeadInField'] = [];
  for (const u of Object.values(state.units)) {
    if (u.hp <= 0 && u.zone === 'field') {
      halfDeadInField.push({
        ownerId: u.ownerId,
        instanceId: u.instanceId,
        name: u.name,
        hp: u.hp,
      });
    }
  }

  // 5. zone=grave 但 fieldSlot/position 残留的"死尸残留"
  const graveWithSlotResidue: DiagnosticsBundle['graveWithSlotResidue'] = [];
  for (const u of Object.values(state.units)) {
    if (u.zone === 'grave' && (u.fieldSlot !== undefined || u.position !== undefined)) {
      graveWithSlotResidue.push({
        ownerId: u.ownerId,
        instanceId: u.instanceId,
        name: u.name,
        fieldSlot: u.fieldSlot,
      });
    }
  }

  // 6. 静默跳过的 (owner, round, sub) 三元组：
  //    遍历 log 里出现过的所有 (round, sub)，对每个 owner 检查是否有 turn_start，
  //    若 owner 在该 (round, sub) 应当登场（fieldSlots 非空 / hp>0）但没有 turn_start，则记一笔
  const allSubRounds = new Set<string>();
  for (const entry of state.log) {
    if (entry.subRound) allSubRounds.add(`${entry.bigRound}-${entry.subRound}`);
  }
  const silentSkips: DiagnosticsBundle['silentSkips'] = [];
  for (const key of allSubRounds) {
    const [r, s] = key.split('-').map((x) => Number(x));
    for (const p of state.players) {
      if (!actorActivityByOwner[p.ownerId]) continue;
      const acted = actorActivityByOwner[p.ownerId].some((it) => it.round === r && it.sub === s);
      if (acted) continue;
      // 当前是死透了的玩家就别记
      if (!p.alive) continue;
      // 这一刻该 owner 在 slotN（N 等于 sub）有可行动单位吗？
      // 注意：这里只能用"当前"状态做近似判定，理想做法是按时间回放。
      // 但导出时只取近似——把所有可疑的都列出来，让人审。
      silentSkips.push({ ownerId: p.ownerId, round: r, sub: s as 1 | 2 });
    }
  }

  return {
    actorActivityByOwner,
    playersWithEmptySlot,
    benchAlive,
    halfDeadInField,
    graveWithSlotResidue,
    silentSkips,
  };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function compactStamp(d: Date): string {
  return (
    String(d.getFullYear()) +
    pad2(d.getMonth() + 1) +
    pad2(d.getDate()) +
    pad2(d.getHours()) +
    pad2(d.getMinutes()) +
    pad2(d.getSeconds())
  );
}

function formatLocal(d: Date): string {
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  );
}
