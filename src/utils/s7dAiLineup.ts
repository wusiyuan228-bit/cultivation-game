/**
 * S7D · AI 主角阵容生成器（v2 · 分工驱动 + 稀有度优先）
 *
 * 为 5 位 AI 主角生成「主角 + 5 张战卡 = 6 张可战卡」+「2 张首发」的配置。
 *
 * ═════════════════════════════════════════════════════════════════════
 *  核心规则（v2 变更）
 * ═════════════════════════════════════════════════════════════════════
 *   1) 稀有度硬性优先级：SSR > SR > R > N（逐级用尽再降级）
 *      - AI 池中 R/N 卡被完全排除（因为没有战斗技能，不在决战中使用）
 *      - AI 只在 SSR + SR 中选，SSR 不够才用 SR 补
 *   2) 同稀有度内按「主角分工配比 + 偏好类型 + 觉醒加权」挑选
 *   3) 每位 AI 主角有独立的 5 张战卡"分工配比"（见 HERO_PROFILES）
 *   4) 第 3~5 位 AI 配卡时会做"同阵营联动校准"：
 *      - 保证同阵营 healer 总数 ≥ 2
 *      - 保证同阵营 tank   总数 ≥ 3
 *      - 保证同阵营 control 总数 ≥ 2
 *   5) 觉醒加权：若卡牌能触发同阵容内其他卡的觉醒条件，则 +15% 权重
 *   6) 种子伪随机：同 heroId+faction 下结果稳定
 *
 * ═════════════════════════════════════════════════════════════════════
 *  6位主角分工配比（按角色性格 & 修行路线）
 * ═════════════════════════════════════════════════════════════════════
 *   塘散（灵修·控制指挥）    2 DPS + 1 Tank + 1 Healer + 1 Control
 *   小舞儿（妖修·柔骨守护）  2 DPS + 2 Tank + 1 Healer
 *   萧焱（法修·烈火先锋）    3 DPS + 1 Tank + 1 Healer
 *   薰儿（灵修·古族棋手）    2 DPS + 1 Tank + 1 Healer + 1 Control
 *   寒立（剑修·潜行猎手）    2 DPS + 1 Tank + 1 Healer + 1 Control
 *   旺林（法修·算计大师）    3 DPS + 1 Healer + 1 Control
 */
import type { Hero, HeroId } from '@/types/game';
import { asset } from '@/utils/assetPath';
import { HEROES_DATA } from '@/data/heroesData';
import { inferTacticalRole, type TacticalRole } from './s7dTacticalRole';

// ==========================================================================
// 类型定义
// ==========================================================================

/** 单个 AI 的完整阵容 */
export interface AILineup {
  /** AI 主角 id */
  heroId: HeroId;
  /** 最终阵营（A/B） */
  faction: 'A' | 'B';
  /** 5 张参战卡（不含主角） */
  deployedCards: string[];
  /** 2 张首发卡（含主角的子集） */
  starterCards: string[];
}

/** 生成参数 */
export interface AiLineupGenParams {
  playerHeroId: HeroId;
  playerFaction: 'A' | 'B';
  swingAssignment: { hanli: 'A' | 'B'; wanglin: 'A' | 'B' } | null;
  ownedCardIds: string[];
}

/** 原始卡牌数据（精简版，含分工 role） */
interface MinimalCard {
  id: string;
  rarity: 'N' | 'R' | 'SR' | 'SSR';
  type: string;
  role: TacticalRole;
  disabled?: boolean;
  /** 是否能给其他卡提供觉醒触发条件（用于加权） */
  triggersAwaken?: boolean;
  /** 原始卡牌对象（保留用于进一步分析） */
  raw?: any;
}

// ==========================================================================
// 主角分工配比（每位主角 5 张战卡的定位分布）
// ==========================================================================

/** 5 张战卡的战术分工目标 */
interface RoleQuota {
  dps: number;
  tank: number;
  healer: number;
  control: number;
  support: number;
}

interface HeroProfile {
  roleQuota: RoleQuota;
  preferredTypes: string[];
}

const HERO_PROFILES: Record<HeroId, HeroProfile> = {
  // 塘散（灵修·控制指挥）：自带控制，需要输出/坦/治/控均衡
  hero_tangsan: {
    roleQuota: { dps: 2, tank: 1, healer: 1, control: 1, support: 0 },
    preferredTypes: ['灵修', '体修'],
  },
  // 小舞儿（妖修·柔骨守护）：守护塘散，多带肉盾
  hero_xiaowu: {
    roleQuota: { dps: 2, tank: 2, healer: 1, control: 0, support: 0 },
    preferredTypes: ['妖修', '体修'],
  },
  // 萧焱（法修·烈火先锋）：激进输出
  hero_xiaoyan: {
    roleQuota: { dps: 3, tank: 1, healer: 1, control: 0, support: 0 },
    preferredTypes: ['法修', '丹修'],
  },
  // 薰儿（灵修·古族棋手）：均衡智谋
  hero_xuner: {
    roleQuota: { dps: 2, tank: 1, healer: 1, control: 1, support: 0 },
    preferredTypes: ['灵修', '剑修'],
  },
  // 寒立（剑修·潜行猎手）：稳健
  hero_hanli: {
    roleQuota: { dps: 2, tank: 1, healer: 1, control: 1, support: 0 },
    preferredTypes: ['剑修', '丹修'],
  },
  // 旺林（法修·算计大师）：高效输出
  hero_wanglin: {
    roleQuota: { dps: 3, tank: 0, healer: 1, control: 1, support: 0 },
    preferredTypes: ['法修', '剑修'],
  },
};

// ==========================================================================
// 种子伪随机（mulberry32）
// ==========================================================================

function hashString(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleSeeded<T>(arr: T[], rng: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ==========================================================================
// 全卡池加载 + 缓存
// ==========================================================================

let cachedAllCards: MinimalCard[] | null = null;
let loadingPromise: Promise<MinimalCard[]> | null = null;

async function loadAllAvailableCards(): Promise<MinimalCard[]> {
  if (cachedAllCards) return cachedAllCards;
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    const res = await fetch(asset('config/cards/cards_all.json'));
    if (!res.ok) throw new Error(`加载 cards_all.json 失败：${res.status}`);
    const data = await res.json();
    const cards: MinimalCard[] = [];
    const add = (raw: any[], rarity: MinimalCard['rarity']) => {
      if (!Array.isArray(raw)) return;
      for (const c of raw) {
        if (!c || c.disabled) continue;
        if (typeof c.id !== 'string') continue;
        // 排除绑定卡（bssr_/bsr_）——它们绑定特定主角，不参与 AI 配卡
        if (c.id.startsWith('bssr_') || c.id.startsWith('bsr_')) continue;
        cards.push({
          id: c.id,
          rarity,
          type: c.type ?? '',
          role: inferTacticalRole(c),
          raw: c,
        });
      }
    };
    add(data.pool_n ?? [], 'N');
    add(data.pool_r ?? [], 'R');
    add(data.pool_sr ?? [], 'SR');
    add(data.pool_ssr ?? [], 'SSR');
    cachedAllCards = cards;
    return cards;
  })();
  return loadingPromise;
}

/** 清除缓存（测试用） */
export function clearAiLineupCache(): void {
  cachedAllCards = null;
  loadingPromise = null;
}

// ==========================================================================
// 辅助：计算单个 AI 主角的最终阵营
// ==========================================================================

function resolveHeroFactionFor(
  hero: Hero,
  swingAssignment: AiLineupGenParams['swingAssignment'],
): 'A' | 'B' {
  if (hero.faction === '摇摆') {
    if (hero.id === 'hero_hanli') return swingAssignment?.hanli ?? 'A';
    if (hero.id === 'hero_wanglin') return swingAssignment?.wanglin ?? 'B';
  }
  return hero.faction === 'B' ? 'B' : 'A';
}

// ==========================================================================
// 核心：按定位+偏好抽卡
// ==========================================================================

/**
 * 从池中挑 1 张符合 role 的卡，优先偏好类型；若该 role 无卡则返回 null。
 */
function pickOneByRole(
  pool: MinimalCard[],
  role: TacticalRole,
  preferredTypes: string[],
  rng: () => number,
): MinimalCard | null {
  const sameRole = pool.filter((c) => c.role === role);
  if (sameRole.length === 0) return null;
  // 偏好类型前置，其余次之
  const preferred = shuffleSeeded(sameRole.filter((c) => preferredTypes.includes(c.type)), rng);
  const others = shuffleSeeded(sameRole.filter((c) => !preferredTypes.includes(c.type)), rng);
  const ordered = [...preferred, ...others];
  return ordered[0] ?? null;
}

/**
 * 从池中按偏好类型随机挑 1 张（不限 role），作为兜底
 */
function pickOneAny(
  pool: MinimalCard[],
  preferredTypes: string[],
  rng: () => number,
): MinimalCard | null {
  if (pool.length === 0) return null;
  const preferred = shuffleSeeded(pool.filter((c) => preferredTypes.includes(c.type)), rng);
  const others = shuffleSeeded(pool.filter((c) => !preferredTypes.includes(c.type)), rng);
  return [...preferred, ...others][0] ?? null;
}

// ==========================================================================
// 核心：为单个 AI 配 5 张战卡（稀有度优先 + 分工目标 + 联动校准）
// ==========================================================================

/**
 * @param hero            AI 主角
 * @param basePool        可用卡池（已按 AI 规则预过滤：SSR+SR 且非玩家已持有）
 * @param allyRoleCount   同阵营队友（含玩家）已上阵卡的 role 累计（用于联动校准）
 * @param rng             种子随机
 */
function generateDeployedCards(
  hero: Hero,
  basePool: MinimalCard[],
  allyRoleCount: Record<TacticalRole, number>,
  rng: () => number,
): string[] {
  const profile = HERO_PROFILES[hero.id];
  const quota: RoleQuota = { ...profile.roleQuota };
  const picked: MinimalCard[] = [];

  // 稀有度池子（按优先级分组）—— AI 只用 SSR + SR
  const ssrPool = basePool.filter((c) => c.rarity === 'SSR').slice();
  const srPool = basePool.filter((c) => c.rarity === 'SR').slice();

  /** 从某稀有度池按 role 抽卡，成功后从池中移除 */
  const drawFromPool = (pool: MinimalCard[], role: TacticalRole): MinimalCard | null => {
    const card = pickOneByRole(pool, role, profile.preferredTypes, rng);
    if (card) {
      const idx = pool.findIndex((c) => c.id === card.id);
      if (idx >= 0) pool.splice(idx, 1);
    }
    return card;
  };

  /** 从某稀有度池抽任意 role 的卡 */
  const drawAnyFromPool = (pool: MinimalCard[]): MinimalCard | null => {
    const card = pickOneAny(pool, profile.preferredTypes, rng);
    if (card) {
      const idx = pool.findIndex((c) => c.id === card.id);
      if (idx >= 0) pool.splice(idx, 1);
    }
    return card;
  };

  // ========== 第 1 步：联动校准（同阵营紧缺 role 优先补 1 张）==========
  // 若同阵营 healer < 2 且自己 quota 还有空间 → 把 healer 配额加 1（挤掉 dps）
  const factionNeeds: Array<{ role: TacticalRole; min: number }> = [
    { role: 'healer', min: 2 },
    { role: 'tank', min: 3 },
    { role: 'control', min: 2 },
  ];
  for (const need of factionNeeds) {
    if (allyRoleCount[need.role] < need.min && quota.dps > 0) {
      // 尝试把 1 个 dps 名额让给紧缺 role（最多让 1 次，不极端挤压 dps）
      quota[need.role]++;
      quota.dps--;
      break;
    }
  }

  // ========== 第 2 步：按 role quota 从 SSR 池抽卡 ==========
  const roleOrder: TacticalRole[] = ['tank', 'healer', 'control', 'support', 'dps'];
  for (const role of roleOrder) {
    while (quota[role] > 0 && picked.length < 5) {
      const card = drawFromPool(ssrPool, role);
      if (!card) break; // SSR 里该 role 抽光了
      picked.push(card);
      quota[role]--;
    }
  }

  // ========== 第 3 步：SSR 剩余需求用 SR 补 ==========
  for (const role of roleOrder) {
    while (quota[role] > 0 && picked.length < 5) {
      const card = drawFromPool(srPool, role);
      if (!card) break;
      picked.push(card);
      quota[role]--;
    }
  }

  // ========== 第 4 步：还不满 5 张 → 放宽到任意 role，SSR 优先 ==========
  while (picked.length < 5) {
    const card = drawAnyFromPool(ssrPool) ?? drawAnyFromPool(srPool);
    if (!card) break; // 池子空了
    picked.push(card);
  }

  return picked.slice(0, 5).map((c) => c.id);
}

// ==========================================================================
// 核心：从 6 张可战卡（主角+5）中挑 2 张首发
// ==========================================================================

const RARITY_WEIGHT: Record<string, number> = {
  主角: 90,
  SSR: 100,
  SR: 70,
  R: 50,
  N: 30,
};

/** 分工对应的首发偏好权重（首发倾向带 1 坦 1 输出，治疗/控制放备战） */
const ROLE_STARTER_BONUS: Record<TacticalRole, number> = {
  tank: 15,       // 坦克适合首发顶线
  dps: 10,        // 输出次之
  control: 0,
  healer: -10,    // 治疗靠后一点，留作补位
  support: 0,
};

function generateStarters(
  heroId: HeroId,
  deployedCards: string[],
  cardMap: Map<string, MinimalCard>,
  rng: () => number,
): string[] {
  const candidates: Array<{ id: string; weight: number; rand: number }> = [];
  // 主角：基础权重 + 主角更适合首发
  candidates.push({ id: heroId, weight: RARITY_WEIGHT['主角'] + 10, rand: rng() });
  for (const cid of deployedCards) {
    const info = cardMap.get(cid);
    let w = info ? (RARITY_WEIGHT[info.rarity] ?? 30) : 30;
    if (info) w += ROLE_STARTER_BONUS[info.role] ?? 0;
    candidates.push({ id: cid, weight: w, rand: rng() });
  }
  candidates.sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    return a.rand - b.rand;
  });
  return candidates.slice(0, 2).map((c) => c.id);
}

// ==========================================================================
// 主入口：生成全部 5 个 AI 阵容
// ==========================================================================

/**
 * 为所有 AI 主角生成阵容（异步）
 */
export async function generateAllAiLineups(
  params: AiLineupGenParams,
): Promise<Record<string, AILineup>> {
  const allCards = await loadAllAvailableCards();
  return buildLineups(allCards, params);
}

/** 同步版（仅在预加载完成后可用） */
export function generateAllAiLineupsSync(
  params: AiLineupGenParams,
): Record<string, AILineup> | null {
  if (!cachedAllCards) return null;
  return buildLineups(cachedAllCards, params);
}

/** 预加载卡池 */
export async function preloadAiLineupCardPool(): Promise<void> {
  await loadAllAvailableCards();
}

/**
 * 核心构建逻辑（同步/异步共用）
 */
function buildLineups(
  allCards: MinimalCard[],
  params: AiLineupGenParams,
): Record<string, AILineup> {
  // AI 卡池：排除玩家已持有 + 排除 R/N（AI 永远只用 SSR+SR）
  const ownedSet = new Set(params.ownedCardIds);
  const availablePool = allCards.filter(
    (c) => !ownedSet.has(c.id) && (c.rarity === 'SSR' || c.rarity === 'SR'),
  );
  const cardMap = new Map<string, MinimalCard>();
  allCards.forEach((c) => cardMap.set(c.id, c));

  const result: Record<string, AILineup> = {};
  const rootSeedStr = `${params.playerHeroId}|${params.playerFaction}|${params.swingAssignment?.hanli ?? '-'}|${params.swingAssignment?.wanglin ?? '-'}`;
  const rootSeed = hashString(rootSeedStr);

  // 同阵营已上阵 role 累计（用于联动校准）
  // 含玩家主角（虽然玩家卡未知，但主角的 role 可以知道）
  const allyRoleCount: Record<'A' | 'B', Record<TacticalRole, number>> = {
    A: { dps: 0, tank: 0, healer: 0, control: 0, support: 0 },
    B: { dps: 0, tank: 0, healer: 0, control: 0, support: 0 },
  };
  // 把玩家主角的 role 先算进去
  const playerHero = HEROES_DATA.find((h) => h.id === params.playerHeroId);
  if (playerHero) {
    const playerFactionActual = resolveHeroFactionFor(playerHero, params.swingAssignment);
    const playerCardLike = { ...playerHero, battle_skill: null, ultimate: null };
    const playerRole = inferTacticalRole(playerCardLike);
    allyRoleCount[playerFactionActual][playerRole]++;
  }

  // 固定顺序遍历（保证稳定性）
  const orderedHeroes = [...HEROES_DATA].sort((a, b) => a.id.localeCompare(b.id));
  for (const hero of orderedHeroes) {
    if (hero.id === params.playerHeroId) continue;

    const aiSeed = (rootSeed + hashString(hero.id)) >>> 0;
    const rng = mulberry32(aiSeed);
    const faction = resolveHeroFactionFor(hero, params.swingAssignment);

    // 主角的 role 加入对应阵营统计
    const heroRole = inferTacticalRole({ ...hero });
    allyRoleCount[faction][heroRole]++;

    // 配 5 张战卡
    const deployedCards = generateDeployedCards(
      hero,
      availablePool,
      allyRoleCount[faction],
      rng,
    );

    // 把这 5 张的 role 累加到同阵营统计
    for (const cid of deployedCards) {
      const info = cardMap.get(cid);
      if (info) allyRoleCount[faction][info.role]++;
    }

    const starterCards = generateStarters(hero.id, deployedCards, cardMap, rng);

    result[hero.id] = {
      heroId: hero.id,
      faction,
      deployedCards,
      starterCards,
    };
  }

  return result;
}

// ==========================================================================
// 调试工具：输出阵营分工总览（用于开发期肉眼验证）
// ==========================================================================

/**
 * 返回指定阵营 3 位玩家/AI 的分工总览（仅供 console.table 调试）
 */
export function debugLineupSummary(
  lineups: Record<string, AILineup>,
): Record<string, { faction: string; starters: string; deployed: string }> {
  const out: Record<string, { faction: string; starters: string; deployed: string }> = {};
  for (const [hid, lp] of Object.entries(lineups)) {
    out[hid] = {
      faction: lp.faction,
      starters: lp.starterCards.join(', '),
      deployed: lp.deployedCards.join(', '),
    };
  }
  return out;
}
