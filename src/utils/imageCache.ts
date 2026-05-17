import { asset } from '@/utils/assetPath';
/**
 * 全局图片缓存管理器
 * - S1 Loading 阶段预加载关键图（背景/Logo/卡牌小图），转为 Blob URL 常驻内存
 * - 卡牌翻面大图（cards_full）体积较大，采用懒加载：第一次访问时下载并缓存
 */

/** 所有卡牌的英文 id —— 与 card_name_map.json / heroesData 保持一致 */
export const CARD_IDS = [
  // 6 主角（基础态）
  'hero_tangsan',
  'hero_xiaowu',
  'hero_xiaoyan',
  'hero_xuner',
  'hero_hanli',
  'hero_wanglin',
  // 6 主角（觉醒态）
  'hero_tangsan_awaken',
  'hero_xiaowu_awaken',
  'hero_xiaoyan_awaken',
  'hero_xuner_awaken',
  'hero_hanli_awaken',
  'hero_wanglin_awaken',
  // 绑定 SSR（6 张）
  'bssr_tanghao',
  'bssr_erming',
  'bssr_yaochen',
  'bssr_guyuan',
  'bssr_nangongwan',
  'bssr_situnan',
  // 绑定 SR（6 张）
  'bsr_tangya',
  'bsr_wangdonger',
  'bsr_xiaozhan',
  'bsr_xiaoyixian',
  'bsr_yinyue',
  'bsr_limuwan',
  // 奖池 SSR（12 张）
  'ssr_bibidong',
  'ssr_huoyuhao',
  'ssr_ningfengzhi',
  'ssr_meidusa',
  'ssr_yunyun',
  'ssr_xiaoxuan',
  'ssr_xuangu',
  'ssr_mocaihuan',
  'ssr_ziling',
  'ssr_zhouyi',
  'ssr_tuosen',
  'ssr_tianyunzi',
  // 奖池 SR（20 张）
  'sr_daimubai',
  'sr_ningrongrong',
  'sr_qianrenxue',
  'sr_aoska',
  'sr_mahongjun',
  'sr_nalanyanran',
  'sr_fengxian',
  'sr_guhe',
  'sr_yafei',
  'sr_ziyan',
  'sr_lifeiyu',
  'sr_hanyunzhi',
  'sr_mupeiling',
  'sr_yuanyao',
  'sr_bingfeng',
  'sr_hongdie',
  'sr_liumei',
  'sr_tenghuayuan',
  'sr_yunquezi',
  'sr_xuliguo',
  // 奖池 R（16 张）
  'r_liuerlong',
  'r_dugubo',
  'r_beibei',
  'r_fulande',
  'r_xiaoxiao',
  'r_fama',
  'r_haibodong',
  'r_linxiuya',
  'r_manhuzi',
  'r_wangchan',
  'r_lihuayuan',
  'r_songyu',
  'r_meiji',
  'r_jimolaoren',
  'r_suntai',
  'r_zhouru',
  // 奖池 N（8 张）
  'n_tailong',
  'n_jiangnannan',
  'n_fengqinger',
  'n_xiaoding',
  'n_zhangtie',
  'n_meining',
  'n_daniu',
  'n_tengli',
] as const;

export type CardId = (typeof CARD_IDS)[number];

/** S1 预加载的高优先级卡牌 id
 *  策略：只预加载"启动后立刻会显示"的卡牌——
 *    - 6 主角（基础态）：S2 主菜单 / S3 角色选择立刻展示
 *    - 6 主角（觉醒态）：S7 决战觉醒后即时切换，不能有白块
 *    - 16 R 卡 + 8 N 卡：第一轮抽卡（S6）就只会抽到 N/R，必须秒显示
 *  其余 SSR/SR/绑定卡走后台懒加载（见 warmupRemainingImages），不阻塞 Loading 条。
 *  总预加载体积约 36 张 × ~55KB ≈ 2MB，4G 网络 1~2 秒内完成。
 */
const PRELOAD_CARD_IDS: readonly string[] = CARD_IDS.filter((id) =>
  /^(hero_|n_|r_)/.test(id)
);

/** 后台预热：Loading 结束后继续加载的其余卡牌（绑定SSR/绑定SR/奖池SSR/奖池SR）*/
const WARMUP_CARD_IDS: readonly string[] = CARD_IDS.filter(
  (id) => !PRELOAD_CARD_IDS.includes(id)
);

/** S1 预加载：背景 + Logo + 高优先级卡牌【小图】 */
export const ALL_IMAGES: Record<string, string> = {
  // S1/S2 合成背景（单张 JPEG，包含水墨+立绘+标题）
  's1_combined': asset('images/bg/s1_combined.jpg'),
  // S3 背景(JPEG, 无透明)
  's3_bg':     asset('images/bg/bg_character_select.jpg'),
  // S6 筹备/抽卡 大殿背景
  's6_hall':   asset('images/bg/s6_hall.jpg'),
  // 高优先级卡牌小图（600x800 JPEG ~130KB）
  ...Object.fromEntries(PRELOAD_CARD_IDS.map((id) => [id, asset(`images/cards/${id}.jpg`)])),
};

/** 单独给翻面大图用的路径表（懒加载） */
function fullImagePath(id: string): string {
  // 🚀 2026-05-17：cards_full 已批量转码为 webp（-44% 体积，约 18MB）
  //   现代浏览器全面支持 webp（Chrome/Edge/Firefox/Safari 14+）
  //   服务器仍保留同名 .jpg 作为兜底（CDN 上若 webp 404 可手动切回）
  return asset(`images/cards_full/${id}.webp`);
}

/** webp 兜底 jpg 路径（极少数老浏览器或部署遗漏 webp 时使用） */
function fullImagePathJpg(id: string): string {
  return asset(`images/cards_full/${id}.jpg`);
}

/**
 * 内部：异步把大图 fetch 成 blob 并写入缓存。
 *   - webp 优先；失败时自动降级 jpg
 *   - HTTP 状态非 2xx / 网络异常都视作"webp 失败"
 *   - 仍失败则把 jpg 路径写入 loading map 让 IMG 标签直接走（最起码可见）
 */
function loadCardFullBlob(id: string): Promise<string> {
  const webpUrl = fullImagePath(id);
  const jpgUrl = fullImagePathJpg(id);

  const fetchAsBlob = (url: string) =>
    fetch(url).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.blob();
    });

  return fetchAsBlob(webpUrl)
    .catch(() => fetchAsBlob(jpgUrl))
    .then((blob) => {
      const blobUrl = URL.createObjectURL(blob);
      fullBlobCache.set(id, blobUrl);
      return blobUrl;
    })
    .catch(() => jpgUrl); // 终极兜底：返回 jpg 路径让 <img> 自行加载
}

const blobCache = new Map<string, string>();
const fullBlobCache = new Map<string, string>();
const fullLoading = new Map<string, Promise<string>>();

let allLoaded = false;

/**
 * S1 预加载（只加载小图），进度 0~1
 */
export function preloadAllImages(onProgress: (p: number) => void): Promise<void> {
  if (allLoaded) {
    onProgress(1);
    return Promise.resolve();
  }

  const entries = Object.entries(ALL_IMAGES);
  const total = entries.length;
  let done = 0;

  return Promise.all(
    entries.map(([key, url]) => {
      return new Promise<void>((resolve) => {
        const img = new Image();
        // 根据扩展名决定保留什么格式，透明 PNG 必须保留 PNG，否则透明区会变黑
        const isPng = /\.png(\?|$)/i.test(url);
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.drawImage(img, 0, 0);
              const mime = isPng ? 'image/png' : 'image/jpeg';
              const quality = isPng ? undefined : 0.9;
              canvas.toBlob((blob) => {
                if (blob) {
                  blobCache.set(key, URL.createObjectURL(blob));
                } else {
                  blobCache.set(key, url);
                }
                done++;
                onProgress(done / total);
                resolve();
              }, mime, quality);
            } else {
              blobCache.set(key, url);
              done++;
              onProgress(done / total);
              resolve();
            }
          } catch {
            blobCache.set(key, url);
            done++;
            onProgress(done / total);
            resolve();
          }
        };
        img.onerror = () => {
          blobCache.set(key, url);
          done++;
          onProgress(done / total);
          resolve();
        };
        img.crossOrigin = 'anonymous';
        img.src = url;
      });
    })
  ).then(() => {
    allLoaded = true;
  });
}

/**
 * 获取缓存的小图 URL
 * 已加载返回 blob URL，否则返回静态路径（兜底，浏览器自行加载）
 *
 * 支持任意卡牌 id：未预加载的SSR卡（如 ssr_bibidong）首次访问时走静态路径，
 * 浏览器会按需下载，后续靠 HTTP 缓存命中。
 */
export function getCachedImage(key: string): string {
  const cached = blobCache.get(key);
  if (cached) return cached;
  if (ALL_IMAGES[key]) return ALL_IMAGES[key];
  // 约定：卡牌 id 开头为 hero_ / bssr_ / bsr_ / ssr_ / sr_ / r_ / n_ / ur_ 的统一走小图路径
  if (/^(hero|bssr|bsr|ssr|sr|r|n|ur)_/.test(key)) {
    return asset(`images/cards/${key}.jpg`);
  }
  return '';
}

/**
 * 获取翻面大图（懒加载 + 永久缓存）
 * 第一次调用直接返回原始 URL 让浏览器发起请求；同时后台 fetch 转 blob
 * 第二次调用命中缓存，瞬时返回 blob URL
 */
export function getCachedCardFull(id: string): string {
  const cached = fullBlobCache.get(id);
  if (cached) return cached;

  // 触发异步加载（只触发一次，自带 webp→jpg 兜底）
  if (!fullLoading.has(id)) {
    fullLoading.set(id, loadCardFullBlob(id));
  }

  // 首次返回 webp 原始路径，浏览器自行加载
  return fullImagePath(id);
}

/** 主动预取大图（在用户停留在详情页时调用，体验更丝滑） */
export function prefetchCardFull(id: string): void {
  if (fullBlobCache.has(id) || fullLoading.has(id)) return;
  fullLoading.set(id, loadCardFullBlob(id));
}

/**
 * 🚀 批量预取大图（战前预热专用）
 *   - 用于 S7/S7B/S7D 战斗初始化时把全部参战棋子的大图提前下载并缓存
 *   - 自动去重（id 列表可包含重复或空字符串）
 *   - 不阻塞主线程：fire-and-forget，错误自动吞掉
 *
 * 使用场景：绝技释放特效需要 cards_full 大图，如果首次访问才下载会"白闪一下"。
 *           战前调用此方法，把双方阵容的所有立绘提前拉到 blob 缓存。
 */
export function prefetchManyCardFull(ids: Array<string | undefined | null>): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    prefetchCardFull(id);
  }
}

/** 是否所有图片已缓存 */
export function isAllImagesCached(): boolean {
  return allLoaded;
}

/**
 * 后台预热：S1 Loading 结束后，异步加载剩余低优先级卡牌（绑定SSR/SR/奖池SSR/奖池SR）
 * - 不阻塞任何 UI，用户在 S2 主菜单停留期间悄悄拉完
 * - 并发限制 4：避免抢占首屏网络带宽
 * - 每张只是发起 HTTP 请求，命中浏览器磁盘缓存；首次到达对应界面时已就绪
 *
 * 调用时机：S1 Loading 完成 → 跳转 S2 时触发
 */
let warmupStarted = false;
export function warmupRemainingImages(): void {
  if (warmupStarted) return;
  warmupStarted = true;

  const ids = [...WARMUP_CARD_IDS];
  const CONCURRENCY = 4;

  const runNext = (): Promise<void> => {
    const id = ids.shift();
    if (!id) return Promise.resolve();
    // 用 <img> 标签触发浏览器 HTTP 缓存，开销极小
    return new Promise<void>((resolve) => {
      const img = new Image();
      img.onload = img.onerror = () => resolve();
      img.src = asset(`images/cards/${id}.jpg`);
    }).then(runNext);
  };

  for (let i = 0; i < CONCURRENCY; i++) void runNext();
}
