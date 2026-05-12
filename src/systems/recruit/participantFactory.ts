/**
 * 参与者初始化工具
 * 根据玩家选择的主角，自动生成玩家 + 5 个 AI 参与者
 */
import type { Participant, PoolCard, RunSkillDef } from '@/types/recruit';
import type { HeroId } from '@/types/game';
import { HEROES_DATA } from '@/data/heroesData';
import { getPoolCardById } from './cardPoolLoader';

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

  // 主角的战斗技能与绝技（UI 层按 showBattleSkill 决定是否显示）
  const rawBattleSkill = bc.skills.battle_skill as any;
  const battleSkill = rawBattleSkill
    ? { name: rawBattleSkill.name, desc: rawBattleSkill.desc, type: rawBattleSkill.type, category: rawBattleSkill.category }
    : null;
  const rawUltimate = (bc.skills as any).ultimate;
  const ultimate = rawUltimate
    ? { name: rawUltimate.name, desc: rawUltimate.desc, type: rawUltimate.type, category: rawUltimate.category }
    : null;

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
    battleSkill,
    ultimate,
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

/**
 * 根据 S7A 剿匪击杀数计算灵石奖励
 * 与 S7_Battle.ResultPanel 的奖励公式保持一致：
 *   - 0 → 8 灵石（保底）
 *   - 1~2 → 15
 *   - 3~4 → 22
 *   - 5~6 → 30
 */
function banditKillReward(kills: number): number {
  if (kills <= 0) return 8;
  if (kills <= 2) return 15;
  if (kills <= 4) return 22;
  return 30;
}

/** AI 风格分配 */
const AI_STYLES: Array<'aggressive' | 'conservative' | 'balanced'> = [
  'aggressive', 'conservative', 'balanced', 'aggressive', 'balanced',
];

/** 跨轮 AI 历史快照 */
export interface AiRecruitSnapshot {
  gems: number;
  ownedCardIds: string[];
}

/**
 * 宗门大比战绩快照（仅 S6c/pool=3 使用）
 * 用于将"剿匪击杀数"主键替换为"宗门大比真实表现"主键
 */
export interface SectMatchRecord {
  /** 玩家第一场（2v2）是否胜利 */
  match1Win: boolean;
  /** 玩家第二场（3v3）是否胜利 */
  match2Win: boolean;
  /** 玩家第一场对手 heroId */
  opp1Id: HeroId | null;
  /** 玩家第二场对手 heroId */
  opp2Id: HeroId | null;
}

/**
 * 计算 S6c 招募顺序排序得分（用于覆盖 s7aKill 字段）
 *
 * 排序规则（数值高优先）：
 * - 玩家：胜2场=100，胜1场=50，全败=0；额外保留剿匪基础分*0.1 作为 tiebreak
 * - 玩家两场对手 AI：因败北降权 → 胜过他们的玩家越多，他们排名越靠后
 *   - 输给玩家2v2 → -10
 *   - 输给玩家3v3 → -10（叠加）
 * - 其他 AI：维持自身 s7aKillMock 数值，不调整
 *
 * 【2026-05-12 修复】
 *   1) 防御 sectRecord.opp1Id/opp2Id 误与 playerHeroId 重合（S7B 抽对手时已防，
 *      此处再加 belt-and-suspenders 守卫，避免玩家被当成"AI 对手"加 +10）
 *   2) 玩家的 baseKill*0.1 浮点 tiebreak 改用整数 keyspace（×100 后再加 baseKill*1）
 *      以根除 0.6000000000000001 这种 IEEE 754 浮点误差
 *   3) AI 的 baseKill 提前 clamp 到 [0, 6]，避免 mock/存档异常导致荒谬大分
 */
function computeSectRankScore(
  isPlayer: boolean,
  heroId: HeroId,
  baseKill: number,
  sectRecord: SectMatchRecord | null,
  playerHeroId?: HeroId,
): number {
  // baseKill 兜底：剿匪击杀数据合法范围 [0,6]，对未经历剿匪 (-1) 保持透传
  const safeBase = baseKill < 0 ? -1 : Math.max(0, Math.min(6, Math.floor(baseKill)));
  if (!sectRecord) return safeBase;

  // 防御性：若 sectRecord 中的对手 ID 错误地等于玩家自己（不应发生，但加守卫）
  // 视为该场对手未知，跳过 ±10 调整
  const safeOpp1 = sectRecord.opp1Id === playerHeroId ? null : sectRecord.opp1Id;
  const safeOpp2 = sectRecord.opp2Id === playerHeroId ? null : sectRecord.opp2Id;

  if (isPlayer) {
    // 玩家：胜场分作为主排序键 (×100 keyspace)，剿匪击杀作为整数 tiebreak (1~6)
    // 例：胜2场剿匪6 → 200+6 = 206；胜1场剿匪3 → 100+3 = 103；全败剿匪6 → 0+6 = 6
    // 不再用 baseKill*0.1 浮点（避免 0.6000000000000001 误差，同时让显示更直观）
    let s = 0;
    if (sectRecord.match1Win) s += 100;
    if (sectRecord.match2Win) s += 100;
    return s + Math.max(0, safeBase);
  }

  // AI：基础分 = mock 剿匪击杀，输给玩家 -10，击败玩家 +10（叠加）
  let s = safeBase;
  if (safeOpp1 === heroId && sectRecord.match1Win) s -= 10;
  if (safeOpp2 === heroId && sectRecord.match2Win) s -= 10;
  if (safeOpp1 === heroId && !sectRecord.match1Win) s += 10;
  if (safeOpp2 === heroId && !sectRecord.match2Win) s += 10;
  return s;
}

/**
 * 根据玩家选的主角，生成 6 名参与者（玩家 + 5AI）
 *
 * @param playerHeroId 玩家主角 id
 * @param playerName 玩家显示名
 * @param playerEarnedGems 玩家当前灵石（来自 gameStore.spiritStones）
 * @param playerBanditKillCount 玩家在 S7A 剿匪战的真实击杀数：
 *   - -1：尚未经历剿匪（S6a 使用）→ AI 也全部用 -1，排序回落到心境值
 *   - 0~6：已经历剿匪（S6b 使用）→ AI 使用各自 hero.s7aKillMock 预设（4~6 区间）
 * @param poolCards 本轮卡池（用于将历史 ownedCardIds 还原为 PoolCard 对象）
 * @param playerOwnedCardIds 玩家已持有的非主角卡 id 列表（跨轮继承，从 gameStore.ownedCardIds 传入）
 * @param aiSnapshot 上一轮结束时记录的 AI 灵石 + 卡片快照（首轮传空对象）
 *   - 若提供且命中 heroId：AI 灵石 = snapshot.gems + 剿匪奖励（若刚打完 S7A）
 *   - 未命中：AI 重新走 simulateAiGems() 模拟前期流程
 */
export function createParticipants(
  playerHeroId: HeroId,
  playerName: string,
  playerEarnedGems: number = 0,
  playerBanditKillCount: number = -1,
  poolCards: PoolCard[] = [],
  playerOwnedCardIds: string[] = [],
  aiSnapshot: Record<string, AiRecruitSnapshot> = {},
  sectRecord: SectMatchRecord | null = null,
): Participant[] {
  const allHeroIds: HeroId[] = [
    'hero_tangsan',
    'hero_xiaowu',
    'hero_xiaoyan',
    'hero_xuner',
    'hero_hanli',
    'hero_wanglin',
  ];

  // 卡池索引：用于 id → PoolCard 回填
  const poolIndex = new Map<string, PoolCard>();
  poolCards.forEach((c) => poolIndex.set(c.id, c));

  const participants: Participant[] = [];

  // ========== 玩家 ==========
  const playerCard = heroToActiveCard(playerHeroId);
  // 还原玩家在之前几轮招募中抽到的非主角卡
  const playerOwned: PoolCard[] = [playerCard];
  playerOwnedCardIds.forEach((id) => {
    if (id === playerHeroId) return; // 跳过主角
    // 优先本轮卡池；本轮不在则从全局已加载卡池中找（跨轮继承的关键）
    const c = poolIndex.get(id) ?? getPoolCardById(id);
    if (c) playerOwned.push(c);
    else {
      console.warn(`[participantFactory] 玩家历史卡 ${id} 在任何已加载卡池中都未找到，已忽略`);
    }
  });

  participants.push({
    id: playerHeroId,
    name: playerName,
    portraitHeroId: playerHeroId,
    isPlayer: true,
    baseMnd: playerCard.mnd,
    baseAtk: playerCard.atk,
    s7aKill: computeSectRankScore(true, playerHeroId, playerBanditKillCount, sectRecord, playerHeroId),
    gems: playerEarnedGems,
    skipUsed: 0,
    skipLimit: 3,
    activeCardId: playerHeroId,
    ownedCards: playerOwned,
    hasSwitchedThisTurn: false,
    rCardsDrawnThisTurn: [],
    skillUseCount: {},
    usedOneshotSkills: [],
    returnForGemUsedThisBigRound: 0,
  });

  // ========== 5 AI ==========
  const aiHeroIds = allHeroIds.filter((id) => id !== playerHeroId);
  aiHeroIds.forEach((heroId, i) => {
    const aiCard = heroToActiveCard(heroId);
    const hero = HEROES_DATA.find((h) => h.id === heroId)!;
    const snap = aiSnapshot[heroId];

    // ---- 灵石 ----
    let aiGems: number;
    if (snap) {
      // 继承上轮剩余灵石
      aiGems = Math.max(0, snap.gems);
      // 如果是首次进入 S6b（玩家刚打完剿匪），给 AI 补发一次剿匪奖励
      // 用 s7aRewardGranted 语义：快照中没有 rewarded 标记，且 playerBanditKillCount >= 0 → 补发
      if (playerBanditKillCount >= 0 && !(snap as any).s7aRewardGranted) {
        aiGems += banditKillReward(hero.s7aKillMock ?? 5);
      }
    } else {
      // 首轮（S6a）：模拟前期跑团流程获得 20~30 灵石
      aiGems = simulateAiGems();
    }

    // ---- 已持卡片 ----
    const aiOwned: PoolCard[] = [aiCard];
    if (snap) {
      snap.ownedCardIds.forEach((id) => {
        if (id === heroId) return;
        // 跨池查找：先本轮卡池，再全局缓存
        const c = poolIndex.get(id) ?? getPoolCardById(id);
        if (c) aiOwned.push(c);
      });
    }

    // ---- 剿匪击杀（用于抽卡顺序排序） ----
    const baseKill = playerBanditKillCount >= 0 ? (hero.s7aKillMock ?? 5) : -1;
    const aiKill = computeSectRankScore(false, heroId, baseKill, sectRecord, playerHeroId);

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
      ownedCards: aiOwned,
      hasSwitchedThisTurn: false,
      rCardsDrawnThisTurn: [],
      skillUseCount: {},
      usedOneshotSkills: [],
      returnForGemUsedThisBigRound: 0,
    });
  });

  return participants;
}
