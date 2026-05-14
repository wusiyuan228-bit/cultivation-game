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
export const S7D_SNAPSHOT_SCHEMA = 2;

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
  /**
   * 每个 owner 在 log 里出现过的 (bigRound, subRound) 集合。
   *
   * S7D 引擎并不会 emit `kind: 'turn_start'` 的 log 事件，因此本字段改为：
   * 扫描所有 `actorId` 不为空的 log entry（attack / move / skill_cast 等），
   * 通过 `state.units[actorId].ownerId` 反查 owner，把对应的 (round, sub) 计入活动表。
   *
   * 这意味着只要某 owner 在某 (round, sub) 内由其任意单位发起过任何"可观测动作"，
   * 就会被视为"曾行动过"。
   */
  actorActivityByOwner: Record<
    string,
    Array<{ round: number; sub: 1 | 2; actorIds: string[] }>
  >;
  /**
   * 每个 owner 的紧凑活动字符串，方便人眼扫描，例如：
   * "ai_hero_xuner: R1-S1✅ R1-S2✅ R2-S1❌ R2-S2✅ R3-S1❌ ..."
   */
  activitySummaryByOwner: Record<string, string>;
  /** 当前每个 owner 是否有任意一槽为空 */
  playersWithEmptySlot: string[];
  /** 当前不在场（zone≠field）但 hp>0 的单位（应该会被补位调度的候选） */
  benchAlive: Array<{ ownerId: string; instanceId: string; name: string; hp: number; zone: string }>;
  /** 当前 hp<=0 但 zone=field 的"半死"单位（reconcileDeadUnits 漏网） */
  halfDeadInField: Array<{ ownerId: string; instanceId: string; name: string; hp: number }>;
  /** 当前 zone=grave 但仍有 fieldSlot/position 的"残留死尸"单位 */
  graveWithSlotResidue: Array<{ ownerId: string; instanceId: string; name: string; fieldSlot?: 1 | 2 }>;
  /**
   * 在战报里完全没出现 actor 活动的 (owner, round, sub) 三元组。
   *
   * 判定规则（更精确）：
   *   - 该 owner 在战报开打到该 (round, sub) 之前未"出局"（无 owner_eliminated / crystal_destroyed 事件）
   *   - 该 (round, sub) 没有任何 owner 名下的单位发起过 attack / move / skill_cast
   *   - 排除战斗已结束之后的回合
   */
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
 * 诊断包：自动从战报 + 当前状态扫出所有"行动轮次缺失"的可疑情况。
 *
 * 核心思路：
 *   S7D 引擎只 emit "结果型" log（attack / move / skill_cast / damage / round_start / sub_round_start ...）
 *   不会 emit 任何 "turn_start" 事件。因此判定"某 owner 在某 (round, sub) 是否行动过"
 *   只能通过扫描带 `actorId` 的事件、反查 ownerId 来归并。
 *
 *   一个 owner 在 (R, S) 行动过 ⇔ 战报里至少出现一次 actorId 属于该 owner、
 *   bigRound==R、subRound==S 的 attack / move / skill_cast 事件。
 */
function buildDiagnostics(state: S7DBattleState): DiagnosticsBundle {
  // ── 1. actorActivityByOwner：聚合所有有 actorId 的 log
  const actorActivityByOwner: Record<
    string,
    Array<{ round: number; sub: 1 | 2; actorIds: string[] }>
  > = {};
  for (const p of state.players) {
    actorActivityByOwner[p.ownerId] = [];
  }

  /** 视作"行动证据"的 log kind */
  const ACTION_KINDS = new Set([
    'attack',
    'move',
    'skill_cast',
    // 万一以后真的加了 turn_start，也兼容
    'turn_start',
  ]);

  for (const entry of state.log) {
    if (!ACTION_KINDS.has(entry.kind)) continue;
    if (!entry.actorId) continue;
    if (!entry.subRound) continue;
    const u = state.units[entry.actorId];
    if (!u) continue;
    const sub = entry.subRound as 1 | 2;
    const list = actorActivityByOwner[u.ownerId];
    if (!list) continue;
    let bucket = list.find((it) => it.round === entry.bigRound && it.sub === sub);
    if (!bucket) {
      bucket = { round: entry.bigRound, sub, actorIds: [] };
      list.push(bucket);
    }
    if (!bucket.actorIds.includes(entry.actorId)) {
      bucket.actorIds.push(entry.actorId);
    }
  }
  // 按 round/sub 排序，便于阅读
  for (const list of Object.values(actorActivityByOwner)) {
    list.sort((a, b) => (a.round - b.round) || (a.sub - b.sub));
  }

  // ── 2. playersWithEmptySlot
  const playersWithEmptySlot: string[] = [];
  for (const p of state.players) {
    if (p.fieldSlots.slot1 === undefined || p.fieldSlots.slot2 === undefined) {
      playersWithEmptySlot.push(p.ownerId);
    }
  }

  // ── 3. benchAlive
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

  // ── 4. halfDeadInField
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

  // ── 5. graveWithSlotResidue
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

  // ── 6. silentSkips：扫所有出现过的 (round, sub)，对每个 owner 检查是否有活动
  //
  //    "owner 已出局"判定：扫 log 中是否出现过该 owner 的 owner_eliminated 事件，
  //    或其 heroId 名下所有单位都进入 grave。这里采用偏保守策略：
  //      - 若 owner 当前 alive=false → 我们再扫 log，找到该 owner 第一次"完全出局"
  //        的 (round, sub) 作为分界点；之后的所有 (R, S) 都不算 silentSkip。
  //      - 若 owner 当前 alive=true → 整局所有 (R, S) 都该有活动。
  const allSubRounds = new Set<string>();
  for (const entry of state.log) {
    if (entry.subRound) allSubRounds.add(`${entry.bigRound}-${entry.subRound}`);
  }

  /** 推算 owner 出局的 (round, sub)（含），之后不再追责 */
  const ownerEliminatedAt: Record<string, { round: number; sub: 1 | 2 } | null> = {};
  for (const p of state.players) {
    ownerEliminatedAt[p.ownerId] = null;
    if (p.alive) continue; // 还活着就 null
    // 找该 owner 名下的所有 unit；其全部进入 grave 的最早 (round, sub) 作为出局点
    const ownedUnits = p.instanceIds
      .map((id) => state.units[id])
      .filter(Boolean);
    if (ownedUnits.length === 0) continue;
    // 简化：取最晚的 deadAtBigRound/SubRound 作为"全队覆灭"时间
    let latestRound = 0;
    let latestSub: 1 | 2 = 1;
    let allDead = true;
    for (const u of ownedUnits) {
      if (u.zone !== 'grave') {
        allDead = false;
        break;
      }
      const r = u.deadAtBigRound ?? 0;
      const s = (u.deadAtSubRound ?? 1) as 1 | 2;
      if (r > latestRound || (r === latestRound && s > latestSub)) {
        latestRound = r;
        latestSub = s;
      }
    }
    if (allDead && latestRound > 0) {
      ownerEliminatedAt[p.ownerId] = { round: latestRound, sub: latestSub };
    }
  }

  /** 战斗结束的 (round, sub)（含），之后的回合都不追责 */
  let battleEndedAt: { round: number; sub: 1 | 2 } | null = null;
  if (state.winner !== null && state.endReason !== null) {
    // 找最后一条 round_end 或最大 (round, sub)
    let maxR = 0;
    let maxS: 1 | 2 = 1;
    for (const entry of state.log) {
      if (entry.bigRound > maxR || (entry.bigRound === maxR && (entry.subRound ?? 1) > maxS)) {
        maxR = entry.bigRound;
        maxS = (entry.subRound ?? 1) as 1 | 2;
      }
    }
    if (maxR > 0) battleEndedAt = { round: maxR, sub: maxS };
  }

  const silentSkips: DiagnosticsBundle['silentSkips'] = [];
  const sortedKeys = Array.from(allSubRounds).sort((a, b) => {
    const [ar, as] = a.split('-').map(Number);
    const [br, bs] = b.split('-').map(Number);
    return (ar - br) || (as - bs);
  });
  for (const key of sortedKeys) {
    const [r, s] = key.split('-').map((x) => Number(x));
    const sub = s as 1 | 2;
    // 战斗结束之后的不算
    if (battleEndedAt) {
      if (r > battleEndedAt.round || (r === battleEndedAt.round && sub > battleEndedAt.sub)) {
        continue;
      }
    }
    for (const p of state.players) {
      const list = actorActivityByOwner[p.ownerId];
      if (!list) continue;
      const acted = list.some((it) => it.round === r && it.sub === sub);
      if (acted) continue;
      // owner 已出局之后不追责
      const elim = ownerEliminatedAt[p.ownerId];
      if (elim) {
        if (r > elim.round || (r === elim.round && sub > elim.sub)) continue;
      }
      silentSkips.push({ ownerId: p.ownerId, round: r, sub });
    }
  }

  // ── 7. activitySummaryByOwner：紧凑的"R1-S1✅ R1-S2❌"字符串
  const activitySummaryByOwner: Record<string, string> = {};
  // 收集战斗里出现过的所有 (round, sub) 并排序
  const orderedSubs = sortedKeys.map((k) => {
    const [rr, ss] = k.split('-').map(Number);
    return { round: rr, sub: ss as 1 | 2 };
  });
  for (const p of state.players) {
    const list = actorActivityByOwner[p.ownerId] || [];
    const elim = ownerEliminatedAt[p.ownerId];
    const segments: string[] = [];
    for (const { round, sub } of orderedSubs) {
      // 战斗结束后不展示
      if (battleEndedAt) {
        if (round > battleEndedAt.round || (round === battleEndedAt.round && sub > battleEndedAt.sub)) continue;
      }
      let mark = '✅';
      const acted = list.some((it) => it.round === round && it.sub === sub);
      if (!acted) {
        if (elim && (round > elim.round || (round === elim.round && sub > elim.sub))) {
          mark = '☠'; // 已出局
        } else {
          mark = '❌'; // 静默跳过
        }
      }
      segments.push(`R${round}-S${sub}${mark}`);
    }
    activitySummaryByOwner[p.ownerId] = segments.join(' ');
  }

  return {
    actorActivityByOwner,
    activitySummaryByOwner,
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
