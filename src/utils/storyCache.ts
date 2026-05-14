/**
 * 剧情JSON缓存管理器
 * - S1阶段预加载ch1-2（所有6角色 × {1, 2a, 2b} = 18个文件）
 * - 选角后预加载ch3-6（所选角色，4个文件）
 * - fetch后缓存在内存中，后续读取零网络请求
 * - 带5次重试 + 指数退避，应对弱网/CDN 抖动
 *
 * 2026-05-13：第二章拆分为 ch2a / ch2b
 *   - ch2a：山门初见（S5a 测试前阅读）
 *   - ch2b：入门余波（拜师后、S6筹备前阅读）
 *
 * 2026-05-14：清理已废弃的 ch2 单文件（仅保留 ch2a/ch2b），
 *   并新增脏数据防御层（BOM 剥离 + 字符串内裸控制字符自动转义）。
 */
import type { StoryData, HeroId } from '@/types/game';
import { asset } from '@/utils/assetPath';

/** 章节键：number 表示主章节（兼容旧逻辑），string 用于子章节如 '2a' / '2b' */
export type ChapterKey = number | string;

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

function cacheKey(heroId: HeroId, chapter: ChapterKey): string {
  return `${heroId}_ch${chapter}`;
}

function buildUrl(heroId: HeroId, chapter: ChapterKey): string {
  const name = HERO_NAME[heroId] ?? heroId;
  return encodeURI(asset(`config/story/story_ch${chapter}_${name}.json`));
}

/** 带重试的fetch
 * 2026-05-13 加固：3 次 → 5 次重试，指数退避（200ms, 400ms, 800ms, 1600ms, 3200ms ≈ 6s）。
 * 弱网/移动端 GitHub Pages CDN 偶发 404/超时时多兜两次。
 * 任一次返回 ok 立即返回；非 ok 也走重试路径。
 */
async function fetchWithRetry(url: string, retries = 5): Promise<Response> {
  let lastErr: unknown = null;
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(url, { cache: 'no-cache' });
      if (r.ok) return r;
      lastErr = new Error(`HTTP ${r.status} ${r.statusText}`);
    } catch (e) {
      lastErr = e;
    }
    if (i < retries - 1) {
      await new Promise((res) => setTimeout(res, 200 * Math.pow(2, i)));
    }
  }
  throw lastErr ?? new Error(`Failed after ${retries} retries: ${url}`);
}

/** 清除某文件的缓存（用于失败后的重试） */
export function clearStoryCache(heroId: HeroId, chapter: ChapterKey): void {
  const key = cacheKey(heroId, chapter);
  cache.delete(key);
  loading.delete(key);
}

/**
 * 状态机：转义 JSON 字符串字面量内的裸控制字符（\r \n \t）。
 * RFC 8259 不允许字符串内出现裸 0x00-0x1F；PowerShell 的 ConvertFrom-Json 容忍但浏览器拒绝。
 * 仅对 " ... " 之内的字符做转义，结构层换行不动。
 * 注意：" 前面有 \ 视为转义；\\ 后面跟的引号不视为字符串边界。
 */
function sanitizeRawControlChars(txt: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (escaped) {
      out += c;
      escaped = false;
      continue;
    }
    if (inString && c === '\\') {
      out += c;
      escaped = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      out += c;
      continue;
    }
    if (inString) {
      if (c === '\n') { out += '\\n'; continue; }
      if (c === '\r') { out += '\\r'; continue; }
      if (c === '\t') { out += '\\t'; continue; }
    }
    out += c;
  }
  return out;
}

/** 加载单章剧情（带缓存+重试） */
export function fetchStory(heroId: HeroId, chapter: ChapterKey): Promise<StoryData | null> {
  const key = cacheKey(heroId, chapter);
  if (cache.has(key)) return Promise.resolve(cache.get(key)!);
  if (loading.has(key)) return loading.get(key)!;

  const p = fetchWithRetry(buildUrl(heroId, chapter))
    .then((r) => r.text())
    .then((txt) => {
      // 2026-05-14：脏数据防御层（双重）
      // (1) BOM：部分编辑器（Win 记事本/Excel）保存 UTF-8 时会写入 BOM (EF BB BF)，
      //     JSON.parse 不接受 → SyntaxError。这里剥掉首字符的 U+FEFF。
      //     案例：story_ch2b_寒立 / story_ch4_小舞儿 / story_ch5_寒立 曾因此加载失败。
      // (2) 字符串内裸控制字符：编辑器手工换行/缩进可能在 "..." 字符串内嵌入裸 CR/LF/TAB，
      //     违反 RFC 8259。PowerShell 的 ConvertFrom-Json 容忍，浏览器/Node 严格模式拒绝。
      //     兜底：先正常 parse，失败时启动状态机扫描转义裸控制字符再重试一次。
      //     案例：story_ch4_萧焱 段落2内嵌裸 \r\n\r\n 导致萧焱主角第四章加载失败。
      const cleaned = txt.charCodeAt(0) === 0xfeff ? txt.slice(1) : txt;
      try {
        return JSON.parse(cleaned) as StoryData;
      } catch (e) {
        const sanitized = sanitizeRawControlChars(cleaned);
        if (sanitized !== cleaned) {
          console.warn(`[storyCache] ${heroId} ch${chapter} JSON 含裸控制字符，已自动转义重试`);
          return JSON.parse(sanitized) as StoryData;
        }
        throw e;
      }
    })
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
export function getCachedStory(heroId: HeroId, chapter: ChapterKey): StoryData | null {
  return cache.get(cacheKey(heroId, chapter)) ?? null;
}

/** 检查某章是否已缓存 */
export function isStoryCached(heroId: HeroId, chapter: ChapterKey): boolean {
  return cache.has(cacheKey(heroId, chapter));
}

/**
 * 预加载ch1 + ch2a + ch2b（所有6角色 × 3章 = 18个文件）
 * 在S1 Loading阶段调用，确保进入S4时剧情已就绪
 *
 * 2026-05-13：原 ch2 拆分为 ch2a/ch2b。
 * 2026-05-14：旧 ch2 文件已删除，仅保留 ch2a / ch2b。
 *
 * @param onProgress 进度回调(0~1)
 */
export function preloadEarlyChapters(onProgress?: (p: number) => void): Promise<void> {
  const tasks: Array<{ heroId: HeroId; ch: ChapterKey }> = [];
  for (const heroId of ALL_HEROES) {
    tasks.push({ heroId, ch: 1 });
    tasks.push({ heroId, ch: '2a' });
    tasks.push({ heroId, ch: '2b' });
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
