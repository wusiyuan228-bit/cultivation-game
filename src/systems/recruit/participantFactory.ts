/**
 * 参与者初始化工具
 * 根据玩家选择的主角，自动生成玩家 + 5 个 AI 参与者
 */
import type { Participant, PoolCard, RunSkillDef } from '@/types/recruit';
import type { HeroId } from '@/types/game';
import { HEROES_DATA } from '@/data/heroesData';

/** 将主角的 battle_card 转为 PoolCard 形式（用于抽卡系统内部统一处理） */
export function heroToActiveCard(heroId: HeroId): PoolCard {
  const hero = HEROES_DATA.find((h) => h.id === heroId);
  if (!hero) throw new Error(`找不到主角：${heroId}`);

  const bc = hero.battle_card;
  const rawSkill = bc.skills.run_skill as any;
  let runSkill: RunSkillDef | null = null;
  if (rawSkill) {
    runSkill = {
      name: rawSkill.name,
      desc: rawSkill.desc,
      category: rawSkill.category ?? 'none',
      params: rawSkill.params ?? {},
    };
  }

  return {
    id: hero.id,
    name: hero.name,
    tribute: hero.tribute,
    rarity: 'SSR',   // 主角按 SSR 展示
    ip: hero.ip as any,
    type: hero.type as any,
    gender: hero.gender as any,
    realm: hero.realm,
    hp: bc.hp,
    atk: bc.atk,
    mnd: bc.mnd,
    runSkill,
    isHeroBattleCard: true,
  };
}

/**
 * 模拟 AI 经历前期跑团流程后获得的灵石总数
 * 遍历真实跑团流程：战斗考核(2场) + 理论考核(2题) + 拜师仪式
 * 若总和 < 20 则重新模拟，确保结果在 20~30 区间
 */
export function simulateAiGems(): number {
  let total: number;
  do {
    // 战斗考核：2场，每场胜5灵石 / 负2灵石
    const battle1 = Math.random() < 0.5 ? 5 : 2;
    const battle2 = Math.random() < 0.5 ? 5 : 2;
    // 理论考核：2题，每题对5灵石 / 错2灵石
    const theory1 = Math.random() < 0.5 ? 5 : 2;
    const theory2 = Math.random() < 0.5 ? 5 : 2;
    // 拜师仪式：三选一（5 / 5 / 10）
    const masterRoll = Math.random();
    const master = masterRoll < 1 / 3 ? 5 : masterRoll < 2 / 3 ? 5 : 10;
    total = battle1 + battle2 + theory1 + theory2 + master;
  } while (total < 20);
  // 组合最大值 = 10+10+10 = 30，下限已由循环保证 >= 20
  return total;
}

/** AI 风格分配 */
const AI_STYLES: Array<'aggressive' | 'conservative' | 'balanced'> = [
  'aggressive', 'conservative', 'balanced', 'aggressive', 'balanced',
];

/**
 * 根据玩家选的主角，生成 6 名参与者（玩家 + 5AI）
 * AI 使用剩余的 5 个主角
 * @param playerHeroId 玩家主角 id
 * @param playerName 玩家显示名
 * @param playerEarnedGems 玩家通过战斗/理论/拜师累积获得的灵石（来自 gameStore.spiritStones）
 *   不再额外添加初始10灵石，灵石全部来自跑团环节的实际获取
 * @param playerBanditKillCount 玩家在 S7A 剿匪战的真实击杀数：
 *   - -1：尚未经历剿匪（S6a 使用）→ AI 也全部用 -1，排序回落到心境值
 *   - 0~8：已经历剿匪（S6b 使用）→ AI 使用各自 hero.s7aKillMock 预设
 */
export function createParticipants(
  playerHeroId: HeroId,
  playerName: string,
  playerEarnedGems: number = 0,
  playerBanditKillCount: number = -1,
): Participant[] {
  const allHeroIds: HeroId[] = [
    'hero_tangsan',
    'hero_xiaowu',
    'hero_xiaoyan',
    'hero_xuner',
    'hero_hanli',
    'hero_wanglin',
  ];

  const participants: Participant[] = [];

  // 玩家：灵石 = 战斗考核 + 理论考核 + 拜师奖励（不含额外初始灵石）
  const playerCard = heroToActiveCard(playerHeroId);
  participants.push({
    id: playerHeroId,
    name: playerName,
    portraitHeroId: playerHeroId,
    isPlayer: true,
    baseMnd: playerCard.mnd,
    baseAtk: playerCard.atk,
    s7aKill: playerBanditKillCount,
    gems: playerEarnedGems,
    skipUsed: 0,
    skipLimit: 3,
    activeCardId: playerHeroId,
    ownedCards: [playerCard],
    hasSwitchedThisTurn: false,
    rCardsDrawnThisTurn: [],
    skillUseCount: {},
    usedOneshotSkills: [],
    returnForGemUsedThisBigRound: 0,
  });

  // 5 AI —— 每个 AI 独立模拟前期流程获得灵石
  const aiHeroIds = allHeroIds.filter((id) => id !== playerHeroId);
  aiHeroIds.forEach((heroId, i) => {
    const aiCard = heroToActiveCard(heroId);
    const hero = HEROES_DATA.find((h) => h.id === heroId)!;
    const aiGems = simulateAiGems();
    // 剿匪击杀数：如果玩家已打过剿匪(>=0)，AI 使用各自预设值；否则保持 -1
    const aiKill = playerBanditKillCount >= 0 ? (hero.s7aKillMock ?? 5) : -1;
    participants.push({
      id: heroId,
      name: hero.name,
      portraitHeroId: heroId,
      isPlayer: false,
      aiStyle: AI_STYLES[i] ?? 'balanced',
      baseMnd: aiCard.mnd,
      baseAtk: aiCard.atk,
      s7aKill: aiKill,
      gems: aiGems,
      skipUsed: 0,
      skipLimit: 3,
      activeCardId: heroId,
      ownedCards: [aiCard],
      hasSwitchedThisTurn: false,
      rCardsDrawnThisTurn: [],
      skillUseCount: {},
      usedOneshotSkills: [],
      returnForGemUsedThisBigRound: 0,
    });
  });

  return participants;
}
