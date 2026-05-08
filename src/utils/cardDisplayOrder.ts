/**
 * 卡牌展示排序 · 全局统一规则
 *
 * 适用范围：所有"查看/整理卡组"类场景
 *   - 右下角 CommonHud 的已收集卡牌弹窗（全局）
 *   - S4 剧情页的卡组查看
 *   - S7_Battle / S7B_Battle 战斗前的卡组侧栏
 *   - S7D 备战界面的卡组面板（后续）
 *   - S6 筹备 / 整理卡组弹窗（后续）
 *
 * 排序规则（稳定、可复现）：
 *   1. 主角始终排在第一位（heroId 匹配则优先级最高）
 *   2. 主角之后，按稀有度降序：SSR → SR → R → N
 *      其中："主角" rarity 被视同 SSR（但因已被规则 1 固定在首位，不参与此级竞争）
 *   3. 同稀有度内，保持原始收集顺序（稳定排序）
 *
 * 使用示例：
 *   const ids = sortCardsForDisplay(allCardIds, currentHeroId, resolveCard);
 */

import type { HeroId, Hero } from '@/types/game';

/** 稀有度权重表：数字越大越靠前 */
const RARITY_WEIGHT: Record<string, number> = {
  主角: 100,
  SSR: 90,
  SR: 70,
  R: 50,
  N: 30,
};

/**
 * 统一的卡牌展示排序函数。
 *
 * @param cardIds 待排序的卡牌 ID 列表（通常是 heroId + ownedCardIds 合并后的结果）
 * @param heroId 当前玩家主角 ID（用于置顶）
 * @param resolveCard 解析单张卡信息的函数（返回 Hero 或 null），用于读取 rarity
 * @returns 排序后的 ID 数组（不含重复）
 */
export function sortCardsForDisplay(
  cardIds: string[],
  heroId: HeroId | null,
  resolveCard: (id: string) => Hero | null,
): string[] {
  // 去重（保留首次出现位置作为原始顺序）
  const seen = new Set<string>();
  const originalOrder: { id: string; origIdx: number }[] = [];
  cardIds.forEach((id) => {
    if (!seen.has(id)) {
      seen.add(id);
      originalOrder.push({ id, origIdx: originalOrder.length });
    }
  });

  // 计算每张卡的排序键
  const scored = originalOrder.map(({ id, origIdx }) => {
    if (id === heroId) {
      // 主角永远置顶
      return { id, isHero: 1, weight: 1000, origIdx };
    }
    const hero = resolveCard(id);
    const rarity = (hero?.rarity ?? 'N') as string;
    return {
      id,
      isHero: 0,
      weight: RARITY_WEIGHT[rarity] ?? 0,
      origIdx,
    };
  });

  // 排序：主角 > 稀有度高 > 原始顺序（稳定排序）
  scored.sort((a, b) => {
    if (a.isHero !== b.isHero) return b.isHero - a.isHero;
    if (a.weight !== b.weight) return b.weight - a.weight;
    return a.origIdx - b.origIdx;
  });

  return scored.map((s) => s.id);
}

/**
 * 便捷封装：获取"主角 + 已收集卡"的完整列表，并按规则排序。
 */
export function getDisplayCardList(
  heroId: HeroId | null,
  ownedCardIds: readonly string[],
  resolveCard: (id: string) => Hero | null,
): string[] {
  const merged: string[] = [];
  if (heroId) merged.push(heroId);
  ownedCardIds.forEach((id) => merged.push(id));
  return sortCardsForDisplay(merged, heroId, resolveCard);
}
