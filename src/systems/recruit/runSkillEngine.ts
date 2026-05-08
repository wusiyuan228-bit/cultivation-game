/**
 * 抽卡技能执行引擎
 *
 * 负责在合适的时机执行每种技能的效果。按 category 分发处理。
 * 每个 handler 返回一个 SkillExecResult，描述该技能产生的状态变化。
 */
import type { PoolCard, Participant, RunSkillDef, Rarity } from '@/types/recruit';
import { pickByFilter, findHighestRarityCard, drawTopN } from './cardPoolLoader';

/** 技能执行上下文 */
export interface SkillContext {
  participant: Participant;
  pool: PoolCard[];
  baseCost: number;          // 池基础费用（NR=5）
}

/** 技能执行结果 */
export interface SkillExecResult {
  /** 消耗灵石（负数=扣除，正数=奖励；0=不变） */
  gemDelta: number;
  /** 更新后的卡池 */
  pool: PoolCard[];
  /** 抽到的卡（立即进入 ownedCards） */
  gainedCards: PoolCard[];
  /** 展示用的候选卡（等玩家 preview 选择用） */
  candidates?: PoolCard[];
  /** 展示战报文本 */
  logText: string;
  /** 技能类型 */
  skillCategory: string;
}

/** T0 被动：计算抽卡费用（薰儿/徐三石/林修涯/董萱儿） */
export function calcDrawCost(baseCost: number, skill: RunSkillDef | null): number {
  if (!skill) return baseCost;
  if (skill.category === 'cost_reduce') {
    const reduce = skill.params?.reduce ?? 0;
    return Math.max(1, baseCost - reduce);  // 最少 1 灵石
  }
  return baseCost;
}

/** T1a: 抽 N 张，返回候选（玩家将从中选 1）*/
export function execPreview(ctx: SkillContext, skill: RunSkillDef): SkillExecResult {
  const count = skill.params?.count ?? 2;
  const { drawn, remaining } = drawTopN(ctx.pool, Math.min(count, ctx.pool.length));
  return {
    gemDelta: -ctx.baseCost,   // 正常消耗
    pool: remaining,
    gainedCards: [],
    candidates: drawn,
    logText: `使用【${skill.name}】预览 ${drawn.length} 张卡待选`,
    skillCategory: skill.category,
  };
}

/** T1b: 额外消耗灵石多抽 1 张 */
export function execExtraDrawPaid(ctx: SkillContext, skill: RunSkillDef): SkillExecResult {
  const extraCost = skill.params?.extraCost ?? 5;
  const firstDraw = drawTopN(ctx.pool, 1);
  const secondDraw = drawTopN(firstDraw.remaining, 1);
  const gained = [...firstDraw.drawn, ...secondDraw.drawn];
  return {
    gemDelta: -(ctx.baseCost + extraCost),
    pool: secondDraw.remaining,
    gainedCards: gained,
    logText: `使用【${skill.name}】额外消耗${extraCost}灵石多抽1张，共抽到 ${gained.length} 张`,
    skillCategory: skill.category,
  };
}

/** T1c: 必定抽到最高稀有度 */
export function execGuaranteeHighest(ctx: SkillContext, skill: RunSkillDef): SkillExecResult {
  const extraCost = skill.params?.extraCost ?? 3;
  const best = findHighestRarityCard(ctx.pool);
  if (!best) {
    return {
      gemDelta: 0,
      pool: ctx.pool,
      gainedCards: [],
      logText: `【${skill.name}】发动失败（卡池为空）`,
      skillCategory: skill.category,
    };
  }
  const { remaining } = pickByFilter(ctx.pool, (c) => c.id === best.id);
  return {
    gemDelta: -(ctx.baseCost + extraCost),
    pool: remaining,
    gainedCards: [best],
    logText: `使用【${skill.name}】额外消耗${extraCost}灵石，必定抽到 [${best.rarity}] ${best.name}`,
    skillCategory: skill.category,
  };
}

/** T1d: 支付 X 灵石指定抽 */
export function execDesignatePaid(
  ctx: SkillContext,
  skill: RunSkillDef,
  designatedCardId: string,
): SkillExecResult {
  const extraCost = skill.params?.extraCost ?? 20;
  const { card, remaining } = pickByFilter(ctx.pool, (c) => c.id === designatedCardId);
  if (!card) {
    return {
      gemDelta: 0,
      pool: ctx.pool,
      gainedCards: [],
      logText: `【${skill.name}】发动失败（目标卡不在池中）`,
      skillCategory: skill.category,
    };
  }
  return {
    gemDelta: -extraCost,   // 指定抽不再叠加基础费用
    pool: remaining,
    gainedCards: [card],
    logText: `使用【${skill.name}】支付${extraCost}灵石，指定抽到 [${card.rarity}] ${card.name}`,
    skillCategory: skill.category,
  };
}

/** T1e: 同 IP 优先 */
export function execSameIpFirst(ctx: SkillContext, skill: RunSkillDef): SkillExecResult {
  const ip = skill.params?.ip;
  if (!ip) {
    const top = drawTopN(ctx.pool, 1);
    return {
      gemDelta: -ctx.baseCost,
      pool: top.remaining,
      gainedCards: top.drawn,
      logText: `使用【${skill.name}】IP未配置，退化为普通抽卡`,
      skillCategory: skill.category,
    };
  }
  const { card, remaining } = pickByFilter(ctx.pool, (c) => c.ip === ip);
  if (card) {
    return {
      gemDelta: -ctx.baseCost,
      pool: remaining,
      gainedCards: [card],
      logText: `使用【${skill.name}】优先抽取 ${ip}，抽到 [${card.rarity}] ${card.name}`,
      skillCategory: skill.category,
    };
  }
  // 没有同IP卡则随机抽
  const top = drawTopN(ctx.pool, 1);
  return {
    gemDelta: -ctx.baseCost,
    pool: top.remaining,
    gainedCards: top.drawn,
    logText: `使用【${skill.name}】未找到 ${ip} 角色，随机抽到 ${top.drawn[0]?.name ?? '空'}`,
    skillCategory: skill.category,
  };
}

/** T1f: 优先性别 */
export function execPreferGender(ctx: SkillContext, skill: RunSkillDef): SkillExecResult {
  const gender = skill.params?.gender;
  if (!gender) {
    const top = drawTopN(ctx.pool, 1);
    return {
      gemDelta: -ctx.baseCost,
      pool: top.remaining,
      gainedCards: top.drawn,
      logText: `使用【${skill.name}】，退化为普通抽卡`,
      skillCategory: skill.category,
    };
  }
  const { card, remaining } = pickByFilter(ctx.pool, (c) => c.gender === gender);
  if (card) {
    return {
      gemDelta: -ctx.baseCost,
      pool: remaining,
      gainedCards: [card],
      logText: `使用【${skill.name}】优先抽取${gender}性角色，抽到 [${card.rarity}] ${card.name}`,
      skillCategory: skill.category,
    };
  }
  const top = drawTopN(ctx.pool, 1);
  return {
    gemDelta: -ctx.baseCost,
    pool: top.remaining,
    gainedCards: top.drawn,
    logText: `使用【${skill.name}】未找到${gender}性角色，随机抽到 ${top.drawn[0]?.name ?? '空'}`,
    skillCategory: skill.category,
  };
}

/** T1g: 免灵石抽 1 次（宋玉，限一次） */
export function execFreeDrawOnce(ctx: SkillContext, skill: RunSkillDef): SkillExecResult {
  const top = drawTopN(ctx.pool, 1);
  return {
    gemDelta: 0,   // 免费
    pool: top.remaining,
    gainedCards: top.drawn,
    logText: `使用【${skill.name}】免灵石抽到 ${top.drawn[0]?.name ?? '空'}`,
    skillCategory: skill.category,
  };
}

/** T2a: 放回换灵石（塘散） —— 需要已抽到的卡作为输入 */
export function execReturnForGem(
  skill: RunSkillDef,
  lastCard: PoolCard,
  pool: PoolCard[],
): { gemDelta: number; pool: PoolCard[]; logText: string } {
  const reward = skill.params?.reward ?? 7;
  // 放回卡池底部
  const newPool = [...pool, lastCard];
  return {
    gemDelta: reward,
    pool: newPool,
    logText: `使用【${skill.name}】将 [${lastCard.rarity}] ${lastCard.name} 放回卡池，获得 ${reward} 灵石`,
  };
}

/** T2b: 抽到N卡可重抽（柳二龙/海波东） */
export function execRerollIfNRarity(
  skill: RunSkillDef,
  lastCard: PoolCard,
  pool: PoolCard[],
): { triggered: boolean; card?: PoolCard; pool: PoolCard[]; logText: string } {
  const rarity = skill.params?.rerollRarity as Rarity | undefined;
  if (!rarity || lastCard.rarity !== rarity) {
    return { triggered: false, pool, logText: '' };
  }
  // 放回底部并再抽一张
  const withReturned = [...pool, lastCard];
  const top = drawTopN(withReturned, 1);
  return {
    triggered: true,
    card: top.drawn[0],
    pool: top.remaining,
    logText: `触发【${skill.name}】：放回 [${rarity}] ${lastCard.name} 重抽，抽到 [${top.drawn[0]?.rarity}] ${top.drawn[0]?.name}`,
  };
}

/** T3: 抽到特定修士类型奖励灵石（赵无极/辛如音/即墨老人） */
export function execBonusByType(
  skill: RunSkillDef,
  lastCard: PoolCard,
): { gemDelta: number; logText: string } {
  const targetType = skill.params?.targetType;
  const reward = skill.params?.reward ?? 5;
  if (lastCard.type === targetType) {
    return {
      gemDelta: reward,
      logText: `触发【${skill.name}】：抽到${targetType}卡，额外获得 ${reward} 灵石`,
    };
  }
  return { gemDelta: 0, logText: '' };
}

/** T4: 跳过获得灵石（寒立/若琳） */
export function execSkipReward(skill: RunSkillDef): { gemDelta: number; logText: string } {
  const reward = skill.params?.reward ?? 3;
  return {
    gemDelta: reward,
    logText: `触发【${skill.name}】：主动跳过获得 ${reward} 灵石`,
  };
}

/** T5: 累积奖励（遁天，使用该卡抽满N次后发奖） */
export function checkAccumReward(
  participant: Participant,
  skill: RunSkillDef,
): { triggered: boolean; gemDelta: number; logText: string } {
  if (skill.category !== 'accum_reward') {
    return { triggered: false, gemDelta: 0, logText: '' };
  }
  const threshold = skill.params?.threshold ?? 3;
  const reward = skill.params?.reward ?? 20;
  const used = participant.skillUseCount[skill.name] ?? 0;
  if (used >= threshold) {
    // 避免重复触发
    if (participant.usedOneshotSkills.includes(skill.name)) {
      return { triggered: false, gemDelta: 0, logText: '' };
    }
    return {
      triggered: true,
      gemDelta: reward,
      logText: `触发【${skill.name}】：累计使用${threshold}次，获得 ${reward} 灵石`,
    };
  }
  return { triggered: false, gemDelta: 0, logText: '' };
}

/**
 * 判断技能的触发时机
 * T0=passive 被动 / T1=pre_draw 抽卡前主动 / T2=post_draw 抽卡后主动 / T3=on_draw 抽卡结算自动 / T4=on_skip 跳过触发 / T5=accum 累计触发
 */
export function getSkillTiming(
  skill: RunSkillDef | null,
): 'passive' | 'pre_draw' | 'post_draw' | 'on_draw' | 'on_skip' | 'accum' | 'none' {
  if (!skill) return 'none';
  switch (skill.category) {
    case 'cost_reduce':
      return 'passive';
    case 'preview_2':
    case 'preview_3':
    case 'extra_draw_paid':
    case 'guarantee_highest':
    case 'designate_paid':
    case 'same_ip_first':
    case 'prefer_female':
    case 'prefer_male':
    case 'free_draw_once':
      return 'pre_draw';
    case 'return_for_gem':
      return 'post_draw';
    case 'reroll_n':
      return 'post_draw';   // 抽到后自动检查是否为N卡
    case 'bonus_by_type':
      return 'on_draw';
    case 'skip_reward':
      return 'on_skip';
    case 'accum_reward':
      return 'accum';
    default:
      return 'none';
  }
}

/** 判断技能是否为主动触发（需要玩家点按钮） */
export function isActiveSkill(skill: RunSkillDef | null): boolean {
  if (!skill) return false;
  const timing = getSkillTiming(skill);
  return timing === 'pre_draw' || timing === 'post_draw';
}
