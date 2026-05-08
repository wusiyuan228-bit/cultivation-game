/**
 * AI 决策系统
 *
 * 每回合 AI 按以下顺序决策：
 * 1. 是否替换抽卡角色（扫描所有 R 卡技能，选最优）
 * 2. 是否主动跳过（灵石不足 or 风格保守）
 * 3. 是否使用主动技能（pre_draw 类）
 * 4. 抽到后的 post_draw 响应
 */
import type { PoolCard, Participant, RunSkillDef } from '@/types/recruit';
import { findHighestRarityCard, RARITY_WEIGHT } from './cardPoolLoader';
import { calcDrawCost, getSkillTiming } from './runSkillEngine';

/** 技能价值评分（AI 决策用，越高越想用） */
export function evaluateSkillValue(
  skill: RunSkillDef | null,
  pool: PoolCard[],
  participant: Participant,
  baseCost: number,
): number {
  if (!skill) return 0;

  const poolHasR = pool.some((c) => c.rarity === 'R');
  const poolHasN = pool.some((c) => c.rarity === 'N');
  const nRatio = pool.filter((c) => c.rarity === 'N').length / Math.max(1, pool.length);

  switch (skill.category) {
    case 'cost_reduce':
      // 被动，按能省多少灵石估价
      return (skill.params?.reduce ?? 0) * 2;

    case 'preview_2':
      return 6 + (poolHasR ? 3 : 0);
    case 'preview_3':
      return 8 + (poolHasR ? 4 : 0);

    case 'extra_draw_paid': {
      const cost = skill.params?.extraCost ?? 5;
      if (participant.gems < baseCost + cost) return 0;
      return 7 - cost * 0.4;  // 额外成本越高越不划算
    }

    case 'guarantee_highest': {
      const cost = skill.params?.extraCost ?? 3;
      if (participant.gems < baseCost + cost) return 0;
      const best = findHighestRarityCard(pool);
      return best ? 8 + RARITY_WEIGHT[best.rarity] - cost * 0.3 : 0;
    }

    case 'designate_paid': {
      const cost = skill.params?.extraCost ?? 20;
      if (participant.gems < cost) return 0;
      const hasR = pool.some((c) => c.rarity === 'R' || c.rarity === 'SR' || c.rarity === 'SSR');
      return hasR ? 6 : 0;
    }

    case 'same_ip_first':
    case 'prefer_female':
    case 'prefer_male':
      return 4;   // 定向抽取，价值中等

    case 'free_draw_once':
      // 免费抽一次，肯定用
      if (participant.usedOneshotSkills.includes(skill.name)) return 0;
      return 10;

    case 'return_for_gem':
      // 只有抽到 N 卡时才有用（post_draw 时判断）
      return poolHasN ? 5 : 3;

    case 'reroll_n':
      return nRatio > 0.3 ? 7 : 3;   // 卡池中 N 卡占比高则价值高

    case 'bonus_by_type':
      return 3;

    case 'skip_reward':
      // 跳过时才有用，风格保守时会主动用
      return participant.aiStyle === 'conservative' ? 5 : 2;

    case 'accum_reward':
      return 4;

    default:
      return 0;
  }
}

/**
 * AI 决策：是否替换抽卡角色
 * 扫描所有拥有的 R 卡，找最优技能
 * @returns 要替换到的卡 id（若为当前已激活卡则 null 表示不换）
 */
export function decideSwitchActiveCard(
  participant: Participant,
  pool: PoolCard[],
  baseCost: number,
): string | null {
  if (participant.hasSwitchedThisTurn) return null;

  // 候选：所有可用的 R 卡（不包括"本轮刚抽到的 R 卡"）
  const candidates: PoolCard[] = [];

  // 1) 当前主卡
  const currentCard = participant.ownedCards.find((c) => c.id === participant.activeCardId);
  if (currentCard) candidates.push(currentCard);

  // 2) 其他所有 R 卡（已抽到并可用的）
  for (const c of participant.ownedCards) {
    if (c.id === participant.activeCardId) continue;
    if (c.rarity !== 'R' && c.rarity !== 'SR' && c.rarity !== 'SSR' && !c.id.startsWith('hero_')) continue;
    // 本轮刚抽到的 R 卡不能使用
    if (participant.rCardsDrawnThisTurn.includes(c.id)) continue;
    candidates.push(c);
  }

  if (candidates.length === 0) return null;

  // 评分取最高
  let best = candidates[0];
  let bestScore = evaluateSkillValue(best.runSkill, pool, participant, baseCost);
  for (let i = 1; i < candidates.length; i++) {
    const score = evaluateSkillValue(candidates[i].runSkill, pool, participant, baseCost);
    if (score > bestScore) {
      best = candidates[i];
      bestScore = score;
    }
  }

  // 风格调整：激进型必换最高分；保守型差异>3才换
  if (best.id === participant.activeCardId) return null;
  const curScore = evaluateSkillValue(currentCard?.runSkill ?? null, pool, participant, baseCost);
  const diff = bestScore - curScore;
  const threshold = participant.aiStyle === 'conservative' ? 3
                   : participant.aiStyle === 'aggressive' ? 0.5
                   : 1.5;
  return diff >= threshold ? best.id : null;
}

/**
 * AI 决策：是否跳过本轮抽卡
 *
 * 策略：
 * 1. 灵石不足自动跳过
 * 2. 保留灵石用于筹备阶段提升境界（每次5灵石）
 * 3. 卡池N卡占比过高时权衡抽卡收益
 * 4. 有skip_reward技能时更倾向跳过
 */
export function decideSkip(
  participant: Participant,
  baseCost: number,
  activeSkill: RunSkillDef | null,
  pool?: PoolCard[],
): boolean {
  const effectiveCost = calcDrawCost(baseCost, activeSkill);

  // 灵石不足自动跳过
  if (participant.gems < effectiveCost) return true;

  // 跳过次数耗尽不能跳
  if (participant.skipUsed >= participant.skipLimit) return false;

  // === 灵石保留策略 ===
  // AI 需要保留约 10 灵石用于筹备阶段提升境界（2次×5灵石）
  const REALM_UPGRADE_RESERVE = 10;
  const gemsAfterDraw = participant.gems - effectiveCost;

  // 强制保底：灵石 ≤ 10 时直接跳过（确保AI最终留约10灵石）
  if (participant.gems <= REALM_UPGRADE_RESERVE) {
    return true;
  }

  // 有 skip_reward 技能：灵石不富裕时优先跳过赚灵石
  if (activeSkill?.category === 'skip_reward') {
    if (participant.gems <= effectiveCost + REALM_UPGRADE_RESERVE) {
      return true;
    }
    if (participant.gems < effectiveCost * 3) {
      return Math.random() < 0.5;
    }
  }

  // === 卡池 N 卡占比策略 ===
  // 如果卡池中 N 卡占比过高，抽卡性价比低，更倾向保留灵石
  if (pool && pool.length > 0) {
    const nRatio = pool.filter((c) => c.rarity === 'N').length / pool.length;
    // 先检查极高占比（>80%），再检查高占比（>60%）
    if (nRatio > 0.8) {
      // N卡占比极高，所有风格都强烈倾向跳过
      if (participant.aiStyle === 'aggressive') return Math.random() < 0.5;
      return Math.random() < 0.75;
    }
    if (nRatio > 0.6) {
      if (participant.aiStyle === 'conservative') return Math.random() < 0.6;
      if (participant.aiStyle === 'balanced') return Math.random() < 0.4;
      if (participant.aiStyle === 'aggressive') return Math.random() < 0.2;
    }
  }

  // 如果抽完后灵石低于保留线，高概率跳过保留灵石
  if (gemsAfterDraw < REALM_UPGRADE_RESERVE) {
    if (participant.aiStyle === 'aggressive') return Math.random() < 0.5;
    if (participant.aiStyle === 'conservative') return Math.random() < 0.85;
    return Math.random() < 0.65;
  }

  // 灵石只够再抽2~3次时，保守/平衡型偶尔囤积
  if (participant.gems < effectiveCost * 3 + REALM_UPGRADE_RESERVE) {
    if (participant.aiStyle === 'conservative') return Math.random() < 0.35;
    if (participant.aiStyle === 'balanced') return Math.random() < 0.2;
  }

  return false;
}

/**
 * AI 决策：是否使用 pre_draw 主动技能
 */
export function decideUsePreDrawSkill(
  participant: Participant,
  pool: PoolCard[],
  baseCost: number,
  skill: RunSkillDef | null,
): boolean {
  if (!skill) return false;
  const timing = getSkillTiming(skill);
  if (timing !== 'pre_draw') return false;

  // 免费抽一次肯定用（只要没用过）
  if (skill.category === 'free_draw_once') {
    return !participant.usedOneshotSkills.includes(skill.name);
  }

  // 额外花费类技能，看灵石是否充裕
  const value = evaluateSkillValue(skill, pool, participant, baseCost);

  // 基础阈值
  const threshold = participant.aiStyle === 'aggressive' ? 4
                   : participant.aiStyle === 'conservative' ? 7
                   : 5.5;

  return value >= threshold;
}

/**
 * AI 决策：抽到卡后是否使用 post_draw 技能（塘散放回换7灵石）
 */
export function decideUsePostDrawSkill(
  participant: Participant,
  lastCard: PoolCard,
  skill: RunSkillDef | null,
): boolean {
  if (!skill) return false;
  if (skill.category !== 'return_for_gem') return false;

  // 每大轮限制 3 次
  if (participant.returnForGemUsedThisBigRound >= 3) return false;

  const reward = skill.params?.reward ?? 7;

  // 只有抽到 N 卡时用（SSR/SR/R 保留）
  if (lastCard.rarity === 'N') return true;

  // 如果抽到 R 且灵石很少，也可以放回换灵石
  if (lastCard.rarity === 'R' && participant.gems < 3 && reward >= 5) {
    return participant.aiStyle !== 'conservative' ? false : true;
  }

  return false;
}

/**
 * AI 从候选卡中选一张保留（preview_N 之后）
 * 策略：选稀有度最高的，同稀有度选 IP 匹配当前角色团的
 */
export function aiPickFromCandidates(candidates: PoolCard[]): PoolCard {
  if (candidates.length === 0) throw new Error('候选卡为空');
  let best = candidates[0];
  for (const c of candidates) {
    if (RARITY_WEIGHT[c.rarity] > RARITY_WEIGHT[best.rarity]) best = c;
  }
  return best;
}

/**
 * AI 指定抽卡（蛮胡子）：从卡池中选稀有度最高的卡
 */
export function aiPickDesignatedCard(pool: PoolCard[]): PoolCard | null {
  return findHighestRarityCard(pool);
}
