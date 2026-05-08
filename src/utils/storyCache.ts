/**
 * 剧情JSON缓存管理器
 * - S1阶段预加载ch1-2（所有6角色，12个文件）
 * - 选角后预加载ch3-6（所选角色，4个文件）
 * - fetch后缓存在内存中，后续读取零网络请求
 * - 带3次重试机制应对Vite中文路径不稳定
 */
import type { StoryData, HeroId } from '@/types/game';
import { asset } from '@/utils/assetPath';

/** 所有角色ID */
const ALL_HEROES: HeroId[] = [
  'hero_tangsan', 'hero_xiaowu', 'hero_xiaoyan',
  'hero_xuner', 'hero_hanli', 'hero_wanglin',
];

/** HeroId → 中文角色名（文件名用中文） */
const HERO_NAME: Record<HeroId, string> = {
  hero_hanli: '寒立',
  hero_tangsan: '塘散',
  hero_xiaowu: '小舞儿',
  hero_xiaoyan: '萧焱',
  hero_xuner: '薰儿',
  hero_wanglin: '旺林',
};

const cache = new Map<string, StoryData>();
const loading = new Map<string, Promise<StoryData | null>>();

function cacheKey(heroId: HeroId, chapter: number): string {
  return `${heroId}_ch${chapter}`;
}

function buildUrl(heroId: HeroId, chapter: number): string {
  const name = HERO_NAME[heroId] ?? heroId;
  return encodeURI(asset(`config/story/story_ch${chapter}_${name}.json`));
}

/** 带重试的fetch */
async function fetchWithRetry(url: string, retries = 3): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return r;
      if (i < retries - 1) await new Promise((r) => setTimeout(r, 200 * (i + 1)));
    } catch {
      if (i < retries - 1) await new Promise((r) => setTimeout(r, 200 * (i + 1)));
    }
  }
  throw new Error(`Failed after ${retries} retries: ${url}`);
}

/** 加载单章剧情（带缓存+重试） */
export function fetchStory(heroId: HeroId, chapter: number): Promise<StoryData | null> {
  const key = cacheKey(heroId, chapter);
  if (cache.has(key)) return Promise.resolve(cache.get(key)!);
  if (loading.has(key)) return loading.get(key)!;

  const p = fetchWithRetry(buildUrl(heroId, chapter))
    .then((r) => r.json())
    .then((data: StoryData) => {
      cache.set(key, data);
      loading.delete(key);
      return data;
    })
    .catch((err) => {
      console.warn(`[storyCache] 加载失败: ${heroId} ch${chapter}`, err);
      loading.delete(key);
      return null;
    });

  loading.set(key, p);
  return p;
}

/** 同步获取已缓存的剧情 */
export function getCachedStory(heroId: HeroId, chapter: number): StoryData | null {
  return cache.get(cacheKey(heroId, chapter)) ?? null;
}

/** 检查某章是否已缓存 */
export function isStoryCached(heroId: HeroId, chapter: number): boolean {
  return cache.has(cacheKey(heroId, chapter));
}

/**
 * 预加载ch1-2（所有6角色 × 2章 = 12个文件）
 * 在S1 Loading阶段调用，确保进入S4时剧情已就绪
 * @param onProgress 进度回调(0~1)
 */
export function preloadEarlyChapters(onProgress?: (p: number) => void): Promise<void> {
  const tasks: Array<{ heroId: HeroId; ch: number }> = [];
  for (const heroId of ALL_HEROES) {
    tasks.push({ heroId, ch: 1 });
    tasks.push({ heroId, ch: 2 });
  }
  const total = tasks.length;
  let done = 0;

  return Promise.all(
    tasks.map(({ heroId, ch }) =>
      fetchStory(heroId, ch).then(() => {
        done++;
        onProgress?.(done / total);
      })
    )
  ).then(() => {});
}

/**
 * 预加载ch3-6（指定角色，4个文件）
 * 在选角确认后后台调用
 */
export function preloadLaterChapters(heroId: HeroId): Promise<void> {
  return Promise.all([3, 4, 5, 6].map((ch) => fetchStory(heroId, ch))).then(() => {});
}
