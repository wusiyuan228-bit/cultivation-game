/**
 * S7D · 战场初始化工具
 *
 * 作用：
 *   把"玩家阵容 + 5 个 AI 阵容"展开为**完整的战场运行时状态**（S7DBattleState）
 *
 * 输入：
 *   - 玩家 heroId / faction / 5 张战卡 / 2 张首发 / 冻结心境
 *   - 5 个 AI 的阵容（由 s7dAiLineup 生成）
 *
 * 输出：
 *   - 完整的 S7DBattleState，可直接喂给 s7dBattleStore
 *
 * 关键步骤：
 *   1. 加载卡池数据（cards_all.json）
 *   2. 构造 6 个玩家的 BattlePlayer
 *   3. 为每人 6 张可战卡创建 BattleCardInstance（3 区分布）
 *   4. 首发 2 张进战斗区（field），位置 = 出生点
 *   5. 其余 4 张进手牌区（hand）
 *   6. 初始化双方水晶
 *   7. 构造第 1 大回合第 1 小轮次的行动队列（按心境降序）
 */

import type {
  BattleCardInstance,
  BattleFaction,
  BattleOwnerId,
  BattlePlayer,
  Crystal,
  GridPos,
  S7DBattleInitParams,
  S7DBattleState,
  S7DBattleLog,
  ActionQueueItem,
} from '@/types/s7dBattle';
import type { CultivationType, Hero, HeroId } from '@/types/game';
import { HEROES_DATA } from '@/data/heroesData';
import { S7D_CRYSTAL_A, S7D_CRYSTAL_B, S7D_SPAWN_A, S7D_SPAWN_B } from '@/data/s7dMap';
import { asset } from '@/utils/assetPath';

// ==========================================================================
// 卡池加载（本文件内独立缓存，避免耦合 s7dAiLineup）
// ==========================================================================

interface RawCardData {
  id: string;
  name: string;
  rarity: 'N' | 'R' | 'SR' | 'SSR';
  type: CultivationType;
  hp: number;
  atk: number;
  mnd: number;
  disabled?: boolean;
  skills?: {
    run_skill?: { name: string; desc: string } | null;
    battle_skill?: { name: string; desc: string } | null;
    ultimate?: { name: string; desc: string } | null;
  };
  image?: string;
  portrait?: string;
}

let cardIndex: Map<string, RawCardData> | null = null;
let loadingPromise: Promise<Map<string, RawCardData>> | null = null;

async function loadCardIndex(): Promise<Map<string, RawCardData>> {
  if (cardIndex) return cardIndex;
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    const res = await fetch(asset('config/cards/cards_all.json'));
    if (!res.ok) throw new Error(`加载 cards_all.json 失败：${res.status}`);
    const data = await res.json();
    const map = new Map<string, RawCardData>();
    const addPool = (arr: any[], rarity: RawCardData['rarity']) => {
      if (!Array.isArray(arr)) return;
      for (const c of arr) {
        if (!c || typeof c.id !== 'string') continue;
        map.set(c.id, { ...c, rarity });
      }
    };
    addPool(data.pool_n ?? [], 'N');
    addPool(data.pool_r ?? [], 'R');
    addPool(data.pool_sr ?? [], 'SR');
    addPool(data.pool_ssr ?? [], 'SSR');
    // 绑定池也要加（注意 JSON 字段名是 bind_ssr/bind_sr）
    addPool(data.bind_ssr ?? data.pool_bssr ?? [], 'SSR');
    addPool(data.bind_sr ?? data.pool_bsr ?? [], 'SR');
    cardIndex = map;
    return map;
  })();
  return loadingPromise;
}

export function clearCardIndexCache(): void {
  cardIndex = null;
  loadingPromise = null;
}

// ==========================================================================
// 工具函数
// ==========================================================================

function getHero(heroId: HeroId): Hero {
  const h = (HEROES_DATA as Hero[]).find((x) => x.id === heroId);
  if (!h) throw new Error(`未知主角: ${heroId}`);
  return h;
}

/** 根据出生点列表 + 已占用坐标，找出下一个可用出生点 */
function findNextSpawn(
  spawns: Array<[number, number]>,
  occupied: Set<string>,
  preferredOffset = 0,
): GridPos | null {
  for (let i = 0; i < spawns.length; i++) {
    const idx = (i + preferredOffset) % spawns.length;
    const [r, c] = spawns[idx];
    const key = `${r},${c}`;
    if (!occupied.has(key)) {
      occupied.add(key);
      return { row: r, col: c };
    }
  }
  return null;
}

// ==========================================================================
// 构造单张卡实例
// ==========================================================================

interface BuildCardCtx {
  ownerId: BattleOwnerId;
  faction: BattleFaction;
  cardId: string;
}

function buildCardInstance(ctx: BuildCardCtx, raw: RawCardData | null, hero: Hero | null): BattleCardInstance {
  const isHero = !!hero;
  const instanceId = `${ctx.ownerId}:${ctx.cardId}`;

  // 主角卡：读取主角 battle_card 数据
  if (isHero && hero) {
    const bc = hero.battle_card;
    return {
      instanceId,
      cardId: ctx.cardId,
      ownerId: ctx.ownerId,
      faction: ctx.faction,
      isHero: true,
      heroId: hero.id,
      name: hero.name,
      type: hero.type,
      rarity: '主角',
      portrait: `hero/${hero.id}`,
      hp: bc.hp,
      hpMax: bc.hp,
      atk: bc.atk,
      mnd: bc.mnd,
      hpInitial: bc.hp,
      atkInitial: bc.atk,
      mndInitial: bc.mnd,
      zone: 'hand', // 先入手牌，后续由 placeStarterOnField 挪到战斗区
      immobilized: false,
      stunned: false,
      hasMovedThisTurn: false,
      hasActedThisTurn: false,
      stepsUsedThisTurn: 0,
      attackedThisTurn: false,
      registrySkills: [`${hero.id}.battle`, `${hero.id}.ultimate`].filter(Boolean),
      ultimateUsed: false,
      skillUsedThisTurn: false,
      ultimateId: bc.skills?.ultimate?.name,
      battleSkillId: bc.skills?.battle_skill?.name,
      battleSkill: bc.skills?.battle_skill
        ? { name: bc.skills.battle_skill.name, desc: bc.skills.battle_skill.desc }
        : null,
      ultimate: bc.skills?.ultimate
        ? { name: bc.skills.ultimate.name, desc: bc.skills.ultimate.desc }
        : null,
      awakened: false,
      form: 'base',
      killCount: 0,
      lastTerrain: null,
    };
  }

  // 战卡：读取 cards_all.json
  if (!raw) {
    // 兜底：卡未找到（防止 AI 阵容给了错误 id 导致崩溃）
    console.warn(`[s7dBattleInit] 未找到卡数据 ${ctx.cardId}，使用占位值`);
    return {
      instanceId,
      cardId: ctx.cardId,
      ownerId: ctx.ownerId,
      faction: ctx.faction,
      isHero: false,
      name: ctx.cardId,
      type: '剑修',
      rarity: 'N',
      portrait: '',
      hp: 3,
      hpMax: 3,
      atk: 1,
      mnd: 1,
      hpInitial: 3,
      atkInitial: 1,
      mndInitial: 1,
      zone: 'hand',
      immobilized: false,
      stunned: false,
      hasMovedThisTurn: false,
      hasActedThisTurn: false,
      stepsUsedThisTurn: 0,
      attackedThisTurn: false,
      registrySkills: [],
      ultimateUsed: false,
      skillUsedThisTurn: false,
      battleSkill: null,
      ultimate: null,
      awakened: false,
      form: 'base',
      killCount: 0,
      lastTerrain: null,
    };
  }

  return {
    instanceId,
    cardId: ctx.cardId,
    ownerId: ctx.ownerId,
    faction: ctx.faction,
    isHero: false,
    name: raw.name,
    type: raw.type,
    rarity: raw.rarity,
    portrait: raw.image ?? raw.portrait ?? '',
    hp: raw.hp,
    hpMax: raw.hp,
    atk: raw.atk,
    mnd: raw.mnd,
    hpInitial: raw.hp,
    atkInitial: raw.atk,
    mndInitial: raw.mnd,
    zone: 'hand',
    immobilized: false,
    stunned: false,
    hasMovedThisTurn: false,
    hasActedThisTurn: false,
    stepsUsedThisTurn: 0,
    attackedThisTurn: false,
    registrySkills: [`${raw.id}.battle`].filter(() =>
      Boolean(raw.skills?.battle_skill || raw.skills?.ultimate),
    ),
    ultimateUsed: false,
    skillUsedThisTurn: false,
    ultimateId: raw.skills?.ultimate?.name,
    battleSkillId: raw.skills?.battle_skill?.name,
    battleSkill: raw.skills?.battle_skill
      ? { name: raw.skills.battle_skill.name, desc: raw.skills.battle_skill.desc }
      : null,
    ultimate: raw.skills?.ultimate
      ? { name: raw.skills.ultimate.name, desc: raw.skills.ultimate.desc }
      : null,
    awakened: false,
    form: 'base',
    killCount: 0,
    lastTerrain: null,
  };
}

// ==========================================================================
// 水晶初始化
// ==========================================================================

function buildCrystal(faction: BattleFaction): Crystal {
  const positions = (faction === 'A' ? S7D_CRYSTAL_A : S7D_CRYSTAL_B).map(
    ([row, col]) => ({ row, col }),
  );
  return {
    faction,
    positions,
    hp: 6,
    hpMax: 6,
    damageLog: [],
  };
}

// ==========================================================================
// 行动队列构造（按心境降序，卡一优先）
// ==========================================================================

/**
 * 为某个小轮次构造行动队列。
 *   - slot=1 时：收集每个玩家战斗区的卡一
 *   - slot=2 时：收集每个玩家战斗区的卡二
 *   - 按 mindFrozen 降序（同分按 ownerId 字典序）
 *   - 若玩家该槽位为空（补位前/补位失败），则该玩家本小轮次跳过
 */
export function buildActionQueue(
  players: BattlePlayer[],
  units: Record<string, BattleCardInstance>,
  slot: 1 | 2,
): ActionQueueItem[] {
  const items: ActionQueueItem[] = [];
  for (const p of players) {
    if (!p.alive) continue;
    const slotInstanceId = slot === 1 ? p.fieldSlots.slot1 : p.fieldSlots.slot2;
    if (!slotInstanceId) continue;
    const unit = units[slotInstanceId];
    if (!unit || unit.zone !== 'field' || unit.hp <= 0) continue;
    items.push({
      instanceId: slotInstanceId,
      ownerId: p.ownerId,
      mindFrozen: p.mindFrozen,
      fieldSlot: slot,
      acted: false,
      skipped: false,
    });
  }
  // 按心境降序，次序键为 ownerId（稳定）
  items.sort((a, b) => {
    if (b.mindFrozen !== a.mindFrozen) return b.mindFrozen - a.mindFrozen;
    return a.ownerId.localeCompare(b.ownerId);
  });
  return items;
}

// ==========================================================================
// 主入口：完整战场初始化
// ==========================================================================

/**
 * 初始化 S7D 战场状态。
 *
 * 注意：本函数是 **async**，因为需要从 cards_all.json 加载卡池数据。
 * Store 层应当 await 其结果，然后一次性 set 到 Store。
 */
export async function initS7DBattle(params: S7DBattleInitParams): Promise<S7DBattleState> {
  const idx = await loadCardIndex();

  const {
    playerHeroId,
    playerFaction,
    playerDeployedCards,
    playerStarterCards,
    playerMindFrozen,
    aiLineups,
    battleId = `s7d_${Date.now()}`,
  } = params;

  const units: Record<string, BattleCardInstance> = {};
  const players: BattlePlayer[] = [];
  const occupiedA = new Set<string>();
  const occupiedB = new Set<string>();

  // ------ 真人玩家 ------
  const playerHero = getHero(playerHeroId);
  const playerOwnerId: BattleOwnerId = 'player';
  const playerCardIds = [playerHeroId, ...playerDeployedCards]; // 6 张

  for (const cardId of playerCardIds) {
    const isHero = cardId === playerHeroId;
    const raw = idx.get(cardId) ?? null;
    const u = buildCardInstance(
      { ownerId: playerOwnerId, faction: playerFaction, cardId },
      raw,
      isHero ? playerHero : null,
    );
    units[u.instanceId] = u;
  }

  // 玩家首发 2 张 → 进战斗区
  const playerStarterInstanceIds = playerStarterCards.map((cid) => `${playerOwnerId}:${cid}`);
  const playerSpawns = playerFaction === 'A' ? S7D_SPAWN_A : S7D_SPAWN_B;
  const playerOccupied = playerFaction === 'A' ? occupiedA : occupiedB;
  const slot1Id = playerStarterInstanceIds[0];
  const slot2Id = playerStarterInstanceIds[1];
  for (const iid of playerStarterInstanceIds) {
    const u = units[iid];
    if (!u) continue;
    const pos = findNextSpawn(playerSpawns, playerOccupied);
    if (!pos) continue;
    u.zone = 'field';
    u.position = pos;
    u.fieldSlot = iid === slot1Id ? 1 : 2;
    u.deployedAtRound = 1;
  }

  players.push({
    ownerId: playerOwnerId,
    isHuman: true,
    heroId: playerHeroId,
    heroName: playerHero.name,
    faction: playerFaction,
    mindFrozen: playerMindFrozen,
    instanceIds: playerCardIds.map((cid) => `${playerOwnerId}:${cid}`),
    fieldSlots: { slot1: slot1Id, slot2: slot2Id },
    alive: true,
  });

  // ------ 5 个 AI 玩家 ------
  for (const ai of aiLineups) {
    const aiHero = getHero(ai.heroId);
    const aiCardIds = [ai.heroId, ...ai.deployedCards]; // 6 张

    for (const cardId of aiCardIds) {
      const isHero = cardId === ai.heroId;
      const raw = idx.get(cardId) ?? null;
      const u = buildCardInstance(
        { ownerId: ai.ownerId, faction: ai.faction, cardId },
        raw,
        isHero ? aiHero : null,
      );
      units[u.instanceId] = u;
    }

    const starterInstanceIds = ai.starterCards.map((cid) => `${ai.ownerId}:${cid}`);
    const aiSpawns = ai.faction === 'A' ? S7D_SPAWN_A : S7D_SPAWN_B;
    const aiOccupied = ai.faction === 'A' ? occupiedA : occupiedB;
    const aiSlot1 = starterInstanceIds[0];
    const aiSlot2 = starterInstanceIds[1];
    for (const iid of starterInstanceIds) {
      const u = units[iid];
      if (!u) continue;
      const pos = findNextSpawn(aiSpawns, aiOccupied);
      if (!pos) continue;
      u.zone = 'field';
      u.position = pos;
      u.fieldSlot = iid === aiSlot1 ? 1 : 2;
      u.deployedAtRound = 1;
    }

    players.push({
      ownerId: ai.ownerId,
      isHuman: false,
      heroId: ai.heroId,
      heroName: aiHero.name,
      faction: ai.faction,
      mindFrozen: ai.mindFrozen,
      instanceIds: aiCardIds.map((cid) => `${ai.ownerId}:${cid}`),
      fieldSlots: { slot1: aiSlot1, slot2: aiSlot2 },
      alive: true,
    });
  }

  // ------ 水晶 ------
  const crystalA = buildCrystal('A');
  const crystalB = buildCrystal('B');

  // ------ 第 1 大回合第 1 小轮次的行动队列 ------
  const actionQueue = buildActionQueue(players, units, 1);

  // ------ 初始战报 ------
  const log: S7DBattleLog[] = [
    {
      seq: 1,
      bigRound: 1,
      kind: 'battle_start',
      text: `坠魔谷决战 · 战斗开始！A 方 3 人 vs B 方 3 人`,
    },
    {
      seq: 2,
      bigRound: 1,
      kind: 'round_start',
      text: `第 1 大回合开始 · 小轮次 1（各方卡一登场）`,
    },
  ];

  return {
    battleId,
    playerHeroId,
    playerFaction,
    players,
    units,
    crystalA,
    crystalB,
    bigRound: 1,
    bigRoundMax: 40,
    subRound: 1,
    phase: 'sub_round_action',
    actionQueue,
    currentActorIdx: 0,
    reinforceQueue: [],
    winner: null,
    endReason: null,
    log,
    logSeq: 2,
  };
}
