import { useEffect, useState } from 'react';
import type { Hero, StoryData, HeroId } from '@/types/game';
import { HEROES_DATA } from '@/data/heroesData';
import { fetchStory, getCachedStory } from '@/utils/storyCache';

/** React Hook：加载6主角（内联数据，无网络请求） */
export function useHeroes() {
  return { heroes: HEROES_DATA, error: null, loading: false };
}

/** 根据ID获取Hero */
export function getHeroById(id: HeroId): Hero | undefined {
  return HEROES_DATA.find((h) => h.id === id);
}

/**
 * React Hook：动态加载指定章节剧情
 * 优先从缓存读取（零延迟），未缓存则 fetch 加载
 */
export function useStory(heroId: HeroId | null, chapter: number) {
  const [story, setStory] = useState<StoryData | null>(() => {
    if (!heroId) return null;
    return getCachedStory(heroId, chapter);
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!heroId) {
      setStory(null);
      setError(null);
      setLoading(false);
      return;
    }

    // 先尝试缓存
    const cached = getCachedStory(heroId, chapter);
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

    fetchStory(heroId, chapter).then((data) => {
      if (canceled) return;
      if (data) {
        setStory(data);
        setLoading(false);
      } else {
        setError(`第${chapter}章剧情加载失败`);
        setLoading(false);
      }
    });

    return () => { canceled = true; };
  }, [heroId, chapter]);

  return { story, error, loading };
}
