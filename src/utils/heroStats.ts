/**
 * 主角属性统一计算工具（单一属性方案 · 2026-05 重构）
 *
 * ─────────────────────────────────────────────────────────────────
 * 设计理念
 *   主角只有一份属性（HP/修为/心境）。任何场景的有效属性都由以下三者叠加：
 *     有效HP   = 基础HP   + cardBonuses[heroId].hp
 *     有效修为 = 基础修为 + cardBonuses[heroId].atk + (主角且 includeMentor 时叠御敌堂)
 *     有效心境 = 基础心境 + cardBonuses[heroId].mnd + (主角且 includeMentor 时叠藏经阁)
 *
 *   - cardBonuses 来自 gameStore，存放每张卡（含主角）境界提升获得的三维+1
 *   - 拜师加成区分玩家与 AI：
 *       玩家主角 → battleBonus / knowledgeBonus（来自 setMentorship）
 *       AI 主角  → aiMentorship[heroId] 决定（'yudi' → 修为+1，'danyao' → 心境+1）
 *     —— 因此 includeMentor=true 时函数会根据 heroId 是否等于玩家 heroId 自动选择来源
 *
 * 使用约定
 *   - 战斗（S7/S7B/S7D）初始化时调用 getEffectiveHeroStats(heroId, { includeMentor: true })
 *     → 玩家主角自动取玩家拜师，AI 主角自动取 AI 拜师
 *   - 跑团界面（S3/S4/S5/S6 显示卡牌数值）同上
 *   - 非主角卡的 cardBonus 叠加由 getEffectiveCardStats 处理
 * ─────────────────────────────────────────────────────────────────
 */

import { HEROES_DATA } from '@/data/heroesData';
import { useGameStore } from '@/stores/gameStore';
import type { Hero, HeroId } from '@/types/game';

export interface EffectiveHeroStats {
  hp: number;
  atk: number;
  mnd: number;
  /** 调试用：基础值 */
  baseHp: number;
  baseAtk: number;
  baseMnd: number;
  /** 调试用：境界提升带来的加成 */
  realmBonusHp: number;
  realmBonusAtk: number;
  realmBonusMnd: number;
  /** 调试用：拜师带来的加成 */
  mentorBonusAtk: number;
  mentorBonusMnd: number;
}

export interface GetStatsOptions {
  /**
   * 是否叠加拜师加成（默认 true）。
   * - true：函数自动根据 heroId 是玩家还是 AI 选择正确的拜师来源
   * - false：只叠基础 + 境界提升，跳过拜师层（用于"对战时显示对方裸值"等特殊场景）
   */
  includeMentor?: boolean;
}

/**
 * 计算指定主角的有效属性。
 */
export function getEffectiveHeroStats(
  heroId: HeroId,
  opts: GetStatsOptions = {},
): EffectiveHeroStats {
  const hero = (HEROES_DATA as Hero[]).find((h) => h.id === heroId);
  if (!hero) {
    // 极端兜底：未知 heroId 返回零值（不应发生）
    return {
      hp: 0, atk: 0, mnd: 0,
      baseHp: 0, baseAtk: 0, baseMnd: 0,
      realmBonusHp: 0, realmBonusAtk: 0, realmBonusMnd: 0,
      mentorBonusAtk: 0, mentorBonusMnd: 0,
    };
  }

  // 单一属性：run_card 与 battle_card 数值相同，任取其一
  const baseHp = hero.run_card.hp;
  const baseAtk = hero.run_card.atk;
  const baseMnd = hero.run_card.mnd;

  const state = useGameStore.getState();
  const cardBonus = state.cardBonuses[heroId] ?? { hp: 0, atk: 0, mnd: 0, realmUps: 0 };

  let mentorAtk = 0;
  let mentorMnd = 0;
  // 默认开启拜师加成；只有显式传 false 才跳过
  const includeMentor = opts.includeMentor !== false;
  if (includeMentor) {
    if (heroId === state.heroId) {
      // 玩家本人拜师 → 来自 setMentorship 写入的 battleBonus / knowledgeBonus
      mentorAtk = state.battleBonus ?? 0;
      mentorMnd = state.knowledgeBonus ?? 0;
    } else {
      // AI 主角拜师 → 来自 aiMentorship 表
      const aiMentor = state.aiMentorship?.[heroId];
      if (aiMentor === 'yudi') mentorAtk = 1;
      else if (aiMentor === 'danyao') mentorMnd = 1;
    }
  }

  return {
    hp: baseHp + cardBonus.hp,
    atk: baseAtk + cardBonus.atk + mentorAtk,
    mnd: baseMnd + cardBonus.mnd + mentorMnd,
    baseHp, baseAtk, baseMnd,
    realmBonusHp: cardBonus.hp,
    realmBonusAtk: cardBonus.atk,
    realmBonusMnd: cardBonus.mnd,
    mentorBonusAtk: mentorAtk,
    mentorBonusMnd: mentorMnd,
  };
}

/**
 * 计算非主角卡（普通战卡）的有效属性。
 *
 * @param baseStats 卡池基础属性
 * @param cardId    卡 id
 */
export function getEffectiveCardStats(
  baseStats: { hp: number; atk: number; mnd: number },
  cardId: string,
): { hp: number; atk: number; mnd: number } {
  const state = useGameStore.getState();
  const bonus = state.cardBonuses[cardId] ?? { hp: 0, atk: 0, mnd: 0, realmUps: 0 };
  return {
    hp: baseStats.hp + bonus.hp,
    atk: baseStats.atk + bonus.atk,
    mnd: baseStats.mnd + bonus.mnd,
  };
}
