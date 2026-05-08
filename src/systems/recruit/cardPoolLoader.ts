/**
 * 抽卡池加载器
 * 从 public/config/cards/cards_all.json 中读取 pool_r + pool_n，构建 NR 池（recruit_1）
 */
import type { PoolCard, RunSkillDef, Rarity, CardIP } from '@/types/recruit';
import { asset } from '@/utils/assetPath';

interface RawSkill {
  name: string;
  desc: string;
  type: string;
  category?: string;
  params?: Record<string, any>;
  reward?: number;
}
interface RawCard {
  id: string;
  name: string;
  tribute?: string;
  rarity: string;
  ip: string;
  type: string;
  gender?: string;
  realm: string;
  hp: number;
  atk: number;
  mnd: number;
  pool?: string[];
  disabled?: boolean;
  skills?: {
    run_skill?: RawSkill | null;
    battle_skill?: RawSkill | null;
  };
}

let cachedPool: PoolCard[] | null = null;
let cachedPool2: PoolCard[] | null = null;
let cachedPool3: PoolCard[] | null = null;
/** 缓存所有已加载卡牌的映射表（id → PoolCard），方便全局查询 */
let cachedCardMap: Map<string, PoolCard> = new Map();

/** 招募1彩蛋：混入招募1池的4张SR（千仞雪/纳兰嫣然/元瑶/藤化原） */
export const POOL1_SR_BONUS_IDS = [
  'sr_qianrenxue',
  'sr_nalanyanran',
  'sr_yuanyao',
  'sr_tenghuayuan',
] as const;

function mapRunSkill(raw: RawSkill | null | undefined): RunSkillDef | null {
  if (!raw) return null;
  if (!raw.category) {
    console.warn(`[cardPoolLoader] 跑团技能缺失 category 字段：${raw.name}`);
    return null;
  }
  return {
    name: raw.name,
    desc: raw.desc,
    category: raw.category as any,
    params: raw.params ?? {},
  };
}

function mapCard(raw: RawCard): PoolCard {
  return {
    id: raw.id,
    name: raw.name,
    tribute: raw.tribute,
    rarity: raw.rarity as Rarity,
    ip: raw.ip as CardIP,
    type: raw.type,
    gender: (raw.gender === '男' || raw.gender === '女') ? raw.gender : undefined,
    realm: raw.realm,
    hp: raw.hp,
    atk: raw.atk,
    mnd: raw.mnd,
    runSkill: mapRunSkill(raw.skills?.run_skill),
  };
}

/** 加载 NR 招募池（recruit_1：8 N + 16 R + 4 SR彩蛋 = 28张）*/
export async function loadRecruitPool1(): Promise<PoolCard[]> {
  if (cachedPool) return cachedPool.slice();
  const res = await fetch(asset('config/cards/cards_all.json'));
  if (!res.ok) {
    throw new Error(`加载卡池失败：${res.status}`);
  }
  const data = await res.json();
  const rCards: RawCard[] = (data.pool_r || []).filter((c: RawCard) => !c.disabled);
  const nCards: RawCard[] = (data.pool_n || []).filter((c: RawCard) => !c.disabled);

  // 彩蛋SR：从 pool_sr 中按固定id捞4张混入
  const allSr: RawCard[] = (data.pool_sr || []);
  const bonusIdSet = new Set<string>(POOL1_SR_BONUS_IDS);
  const srBonus: RawCard[] = allSr.filter(
    (c: RawCard) => bonusIdSet.has(c.id) && !c.disabled,
  );
  if (srBonus.length !== POOL1_SR_BONUS_IDS.length) {
    console.warn(
      `[cardPoolLoader] 招募1彩蛋SR期望${POOL1_SR_BONUS_IDS.length}张，实际加载${srBonus.length}张。`,
      `缺失id: ${POOL1_SR_BONUS_IDS.filter(id => !srBonus.some(c => c.id === id)).join(',')}`,
    );
  }

  const cards: PoolCard[] = [
    ...rCards.map(mapCard),
    ...nCards.map(mapCard),
    ...srBonus.map(mapCard),
  ];

  cachedPool = cards;
  // 同步更新映射表
  cards.forEach((c) => cachedCardMap.set(c.id, c));
  return cards.slice();
}

/**
 * 加载 SR 招募池（recruit_2）
 * 规则：从 pool_sr 加载所有 SR，排除：
 *   ① 4张已混入招募1的彩蛋SR（POOL1_SR_BONUS_IDS）
 *   ② 全部 disabled:true 的注释SR
 *   ③ 所有 id 以 bsr_ 开头的绑定SR（虽然一般不在 pool_sr 里，稳妥起见加守门）
 */
export async function loadRecruitPool2(): Promise<PoolCard[]> {
  if (cachedPool2) return cachedPool2.slice();
  const res = await fetch(asset('config/cards/cards_all.json'));
  if (!res.ok) {
    throw new Error(`加载SR卡池失败：${res.status}`);
  }
  const data = await res.json();
  const allSr: RawCard[] = (data.pool_sr || []);
  const bonusIdSet = new Set<string>(POOL1_SR_BONUS_IDS);

  const srCards: RawCard[] = allSr.filter((c: RawCard) => {
    if (c.disabled) return false;              // 排除注释SR
    if (bonusIdSet.has(c.id)) return false;    // 排除4张彩蛋SR（已在招募1）
    if (c.id.startsWith('bsr_')) return false; // 排除绑定SR
    return true;
  });

  const cards: PoolCard[] = srCards.map(mapCard);
  cachedPool2 = cards;
  // 同步更新映射表
  cards.forEach((c) => cachedCardMap.set(c.id, c));
  return cards.slice();
}

/**
 * 加载精英招募池（recruit_3 / S6c）
 * 规则（按 card_pools.json pool_3_elite 定义）：
 *   ① 全部非绑定 SSR（pool_ssr 且排除 disabled 和 id 以 bssr_ 开头者）
 *   ② 招募2中未被抽走的剩余 SR —— 由调用方传入 `leftoverSrIds`，本函数会按 id 匹配 pool_sr 后追加
 *
 * @param leftoverSrIds S6b 结束后未被抽走的 SR 卡 id 列表（可空）
 */
export async function loadRecruitPool3(leftoverSrIds: string[] = []): Promise<PoolCard[]> {
  // 基础 SSR 池缓存（不含 leftover SR，因为 leftover 每次可能不同）
  let basePool: PoolCard[];
  if (cachedPool3) {
    basePool = cachedPool3.slice();
  } else {
    const res = await fetch(asset('config/cards/cards_all.json'));
    if (!res.ok) {
      throw new Error(`加载精英池失败：${res.status}`);
    }
    const data = await res.json();
    const allSsr: RawCard[] = (data.pool_ssr || []);

    const ssrCards: RawCard[] = allSsr.filter((c: RawCard) => {
      if (c.disabled) return false;               // 排除注释SSR
      if (c.id.startsWith('bssr_')) return false; // 排除绑定SSR（第五章发放）
      return true;
    });

    const cards: PoolCard[] = ssrCards.map(mapCard);
    cachedPool3 = cards;
    // 同步更新映射表
    cards.forEach((c) => cachedCardMap.set(c.id, c));
    basePool = cards.slice();
  }

  // 若存在"S6b 未抽走的 SR"，从 pool_sr 中找出对应卡追加进精英池
  if (leftoverSrIds.length > 0) {
    // 需要 pool_2 的 SR 数据。若 cachedPool2 已加载则直接用，否则再取一次
    let srAll: PoolCard[];
    if (cachedPool2) {
      srAll = cachedPool2;
    } else {
      srAll = await loadRecruitPool2();
    }
    const leftoverSet = new Set(leftoverSrIds);
    const leftoverCards = srAll.filter((c) => leftoverSet.has(c.id));
    basePool = basePool.concat(leftoverCards);
  }

  return basePool;
}
export function clearPoolCache(): void {
  cachedPool = null;
  cachedPool2 = null;
  cachedPool3 = null;
  cachedCardMap.clear();
}

/**
 * 根据卡牌 id 从缓存池中查找（R/N 卡皆可）
 * 需要在 loadRecruitPool1() 调用后使用
 */
export function getPoolCardById(id: string): PoolCard | null {
  return cachedCardMap.get(id) ?? null;
}

/** 洗牌 */
export function shuffle<T>(arr: T[], rng: () => number = Math.random): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 从池顶抽 N 张（不放回） */
export function drawTopN(pool: PoolCard[], n: number): {
  drawn: PoolCard[];
  remaining: PoolCard[];
} {
  const drawn = pool.slice(0, n);
  const remaining = pool.slice(n);
  return { drawn, remaining };
}

/** 按条件从池中找一张（同 IP / 同性别 / 最高稀有度 / 指定 id） */
export function pickByFilter(
  pool: PoolCard[],
  filter: (c: PoolCard) => boolean,
): { card: PoolCard | null; remaining: PoolCard[] } {
  const idx = pool.findIndex(filter);
  if (idx === -1) return { card: null, remaining: pool.slice() };
  const card = pool[idx];
  const remaining = pool.slice(0, idx).concat(pool.slice(idx + 1));
  return { card, remaining };
}

/** 统计卡池中各稀有度数量 */
export function countByRarity(pool: PoolCard[]): Record<Rarity, number> {
  const result: Record<Rarity, number> = { N: 0, R: 0, SR: 0, SSR: 0, UR: 0 };
  pool.forEach((c) => { result[c.rarity] = (result[c.rarity] || 0) + 1; });
  return result;
}

/** 稀有度排序权重（UR > SSR > SR > R > N） */
export const RARITY_WEIGHT: Record<Rarity, number> = {
  N: 1, R: 2, SR: 3, SSR: 4, UR: 5,
};

/** 找到池中最高稀有度的卡 */
export function findHighestRarityCard(pool: PoolCard[]): PoolCard | null {
  if (pool.length === 0) return null;
  let best = pool[0];
  for (const c of pool) {
    if (RARITY_WEIGHT[c.rarity] > RARITY_WEIGHT[best.rarity]) best = c;
  }
  return best;
}
