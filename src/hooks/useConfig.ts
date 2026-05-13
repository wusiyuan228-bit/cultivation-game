import { useEffect, useState, useCallback } from 'react';
import type { Hero, StoryData, HeroId } from '@/types/game';
import { HEROES_DATA } from '@/data/heroesData';
import { fetchStory, getCachedStory, clearStoryCache, type ChapterKey } from '@/utils/storyCache';

/** React Hook：加载6主角（内联数据，无网络请求） */
export function useHeroes() {
  return { heroes: HEROES_DATA, error: null, loading: false };
}

/** 根据ID获取Hero */
export function getHeroById(id: HeroId): Hero | undefined {
  return HEROES_DATA.find((h) => h.id === id);
}

/**
 * 根据 chapter（number）+ subChapter（''/'a'/'b'）拼接出文件键
 *   - chapter=2, subChapter='a' → '2a'
 *   - chapter=2, subChapter='b' → '2b'
 *   - 其他情况：直接返回 chapter（number）
 */
function resolveChapterKey(chapter: number, subChapter: '' | 'a' | 'b'): ChapterKey {
  if (chapter === 2 && (subChapter === 'a' || subChapter === 'b')) {
    return `2${subChapter}`;
  }
  return chapter;
}

/**
 * React Hook：动态加载指定章节剧情
 * 优先从缓存读取（零延迟），未缓存则 fetch 加载
 *
 * @param heroId      主角ID
 * @param chapter     章节号（1-6）
 * @param subChapter  第二章子段标识（''/'a'/'b'）。仅在 chapter===2 时有意义。
 */
export function useStory(
  heroId: HeroId | null,
  chapter: number,
  subChapter: '' | 'a' | 'b' = '',
) {
  const key = resolveChapterKey(chapter, subChapter);
  const [story, setStory] = useState<StoryData | null>(() => {
    if (!heroId) return null;
    return getCachedStory(heroId, key);
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // 2026-05-13：reload 计数器 —— 调用 reload() 后递增，触发 useEffect 重新执行
  const [reloadTick, setReloadTick] = useState(0);

  /** 手动重试：清缓存 + 重新 fetch */
  const reload = useCallback(() => {
    if (!heroId) return;
    clearStoryCache(heroId, key);
    setReloadTick((t) => t + 1);
  }, [heroId, key]);

  useEffect(() => {
    if (!heroId) {
      setStory(null);
      setError(null);
      setLoading(false);
      return;
    }

    // 先尝试缓存
    const cached = getCachedStory(heroId, key);
    if (cached) {
      setStory(cached);
      setError(null);
      setLoading(false);
      return;
    }

    // 缓存未命中，fetch加载
    let canceled = false;
    setLoading(true);
    setError(null);
    setStory(null);

    fetchStory(heroId, key).then((data) => {
      if (canceled) return;
      if (data) {
        setStory(data);
        setLoading(false);
      } else {
        setError(`第${key}章剧情加载失败`);
        setLoading(false);
      }
    });

    return () => { canceled = true; };
  }, [heroId, key, reloadTick]);

  return { story, error, loading, reload };
}
