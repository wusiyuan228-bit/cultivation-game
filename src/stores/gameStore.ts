import { create } from 'zustand';
import type { HeroId, SaveSlot, MentorshipId, S7DFinalResult } from '@/types/game';
import { HEROES_DATA } from '@/data/heroesData';
import { AI_MENTORSHIP_TABLE } from '@/data/aiProgression';

/** 单张卡牌的游戏过程加成（境界提升等） */
export interface CardBonus {
  hp: number;
  atk: number;
  mnd: number;
  /** 已提升境界次数 */
  realmUps: number;
}

/**
 * 结构化线索条目 —— 用于 S8 密谈线索库展示
 *  - source: 'coop' 合作清怪获得 ｜ 'negotiation' 密谈获得
 *  - fromHero: 密谈来源主角id（coop来源为 null）
 *  - round: 第几轮密谈（1/2/3），coop来源记为 0
 */
export interface ClueEntry {
  id: string;              // 线索唯一id（重复则不再写入）
  title: string;           // 线索标题
  summary: string;         // 线索正文
  source: 'coop' | 'negotiation';
  fromHero: HeroId | null;
  round: number;
  timestamp: number;
}

/**
 * 章节流程状态
 * 每章结束后需要完成特定流程才能进入下一章
 */
export interface ChapterProgress {
  /** 当前章节的剧情是否已读完 */
  storyDone: boolean;
  /** 当前章节的玩法环节是否已完成（骰子/问答/抽卡/战斗等） */
  phaseDone: boolean;
}

/**
 * 每章进入下一章的前置条件说明
 * ch1 → ch2: 读完第一章剧情即可
 * ch2 → ch3: 入门试炼完成（S5骰子判定+知识问答+拜师选择）+ 首次抽卡(S6)完成
 * ch3 → ch4: 合作清怪完成 + 密谈完成 + 第二次抽卡完成
 * ch4 → ch5: 宗门比斗完成 + 第三次抽卡完成
 * ch5 → ch6: 最终决战完成
 */
export const CHAPTER_PREREQ_DESC: Record<number, string> = {
  2: '完成入门试炼与首次招募后开启',
  3: '完成合作清怪、密谈与第二次招募后开启',
  4: '完成宗门比斗与精英招募后开启',
  5: '完成宗门比斗与神灵降世招募后开启',
  6: '完成最终决战后开启',
};

/** S5 入门测试子环节进度 */
export interface S5Progress {
  /** 战斗考核：已完成的对手数（0/1/2） */
  battlePassed: number;
  /** 战斗考核累计胜场 */
  battleWon: number;
  /** 理综考核：已答题数 */
  quizAnswered: number;
  /** 理综考核累计答对数 */
  quizCorrect: number;
  /** 拜师已选择的部门 */
  mentorship: MentorshipId | null;
}

interface GameState {
  heroId: HeroId | null;
  heroName: string;
  chapter: number;
  /**
   * 第二章子段标识（2026-05-13 拆分新增）
   *   - ''  : 普通章节（chapter≠2 时恒为 ''）
   *   - 'a' : 第二章前篇·山门初见（S5a 测试前阅读）
   *   - 'b' : 第二章后篇·入门余波（拜师后、S6筹备前阅读）
   * 仅在 chapter === 2 时有意义；其他章节恒为 ''。
   */
  storySubChapter: '' | 'a' | 'b';
  segmentIndex: number;
  spiritStones: number;
  ownedCardIds: string[];
  clues: string[];
  /** 结构化线索库（2026-05 新增，原 clues: string[] 保留兼容） */
  clueEntries: ClueEntry[];
  /** 已完成的密谈话题id集合（跨轮次全局去重，避免问同一问题） */
  negotiationAskedTopics: string[];
  /** 每个主角被密谈的次数 */
  negotiationTalkedTimes: Partial<Record<HeroId, number>>;
  /** 每个主角在当前阵营中的阵营倾向分（决定摇摆位最终选边） */
  factionAffinity: { A: number; B: number };
  /** 每章的流程进度 */
  chapterProgress: Record<number, ChapterProgress>;
  /** S5 入门测试进度 */
  s5: S5Progress;
  /** 战斗修为判定加成（御敌堂拜师 → 修为+1） */
  battleBonus: number;
  /** 知识心境判定加成（藏经阁拜师 → 心境+1） */
  knowledgeBonus: number;
  /**
   * AI 主角的拜师选择 → 决定 AI 主角的修为/心境拜师加成
   *   yudi   → AI 修为+1
   *   danyao → AI 心境+1
   * 在玩家完成 S5c 后由 applyAiMentorships 一次性写入。
   */
  aiMentorship: Partial<Record<HeroId, MentorshipId>>;
  /** 卡牌境界（主角卡）—— 保留兼容旧存档 */
  mentalLevel: '凡人' | '炼气' | '筑基' | '结丹';
  /** 每张卡牌的个别属性加成（境界提升带来的三维+1） */
  cardBonuses: Record<string, CardBonus>;
  /** 当前章节是否已完成招募（每个筹备阶段仅允许一次招募） */
  recruitDone: boolean;
  /**
   * 宗门剿匪（S7A）玩家击杀数。
   *   - 默认 -1 表示尚未经历剿匪（S6a 使用）
   *   - 0~8 表示剿匪战实际击杀数，S6b 抽卡顺序排序主键
   */
  lastBanditKillCount: number;
  /**
   * S6b（招募2·SR独立池）结束后未被抽走的 SR 卡 id 列表。
   * S6c（精英池）初始化时会读取该列表并与 12 张非绑定 SSR 合并成最终卡池。
   * 若未经历 S6b（老存档或跳过测试），此字段为空数组，S6c 仅使用 12 张 SSR。
   */
  pool2RemainingSr: string[];
  /**
   * 站边阵容（最终密谈 S8c 结束后由玩家或剧本确定）
   *   - 'A' = 护道派
   *   - 'B' = 弑道派
   *   - null = 尚未确定
   */
  finalFaction: 'A' | 'B' | null;

  /**
   * 摇摆位（寒立 / 旺林）的最终阵营归属。
   *   - 摇摆位主角（寒立或旺林为玩家）：玩家选择的派即主角所去派，另一人自动反阵
   *   - 非摇摆位主角（塘散/小舞儿/萧焱/薰儿为玩家）：寒立和旺林随机分执两端
   *   - null = 尚未决定（未进入 S8c 或已进入但未选择）
   */
  swingAssignment: { hanli: 'A' | 'B'; wanglin: 'A' | 'B' } | null;

  /**
   * S7D 坠魔谷决战 · 备战选卡结果。
   *   - 玩家从全部非主角卡中挑选 5 张参战（主角始终上阵，不在此列表）
   *   - 战斗时可上阵的卡 = [主角] + 此 5 张 = 共 6 张
   *   - null = 尚未进入备战页或未确认
   */
  s7dDeployedCards: string[] | null;

  /**
   * S7D 坠魔谷决战 · 首发登场阵容。
   *   - 从 6 张可上阵卡（主角 + s7dDeployedCards 5 张）中挑选 2 张首发
   *   - 剩余 4 张进入手牌区，等己方场上卡被击败后手动补位
   *   - null = 尚未进入首发页或未确认
   */
  s7dStarters: string[] | null;

  /**
   * S7D 坠魔谷决战 · 5 个 AI 主角的阵容快照。
   *   - key = AI 主角 id（不含玩家主角）
   *   - 每位 AI 有：faction（阵营）、deployedCards（5 张战卡）、starterCards（2 张首发）
   *   - 由 s7dAiLineup.generateAllAiLineups() 生成，写入后保持不变（除非显式重置）
   *   - 用于 S7D_PreBattle 显示敌方/友方信息，以及 S7_Battle 决战的 AI 行为
   *   - null = 尚未生成（进入 S7D_PreBattle 时自动生成）
   */
  s7dAiLineups: Record<string, { heroId: HeroId; faction: 'A' | 'B'; deployedCards: string[]; starterCards: string[] }> | null;

  /**
   * S7D 坠魔谷决战最终结果。
   *   - null = 尚未完成决战
   *   - S7D_Battle 战斗结算时由 setS7DFinalResult 写入
   *   - 影响 S4 第六章渲染哪段 endings（victory/defeat/draw）
   */
  s7dFinalResult: S7DFinalResult | null;

  /**
   * S6 招募 · AI 道友跨轮持久化快照
   *   - key = AI 主角 id（不含玩家主角）
   *   - 每轮 S6 结束时写入：灵石余额 + 已抽到的非主角卡 id 列表
   *   - 下一轮 S6 初始化时优先读取，恢复 AI 的灵石 + 卡片，并叠加剿匪奖励
   *   - 空对象 = 尚未经历过任何一轮招募（首次 S6a）
   */
  aiRecruitState: Record<string, { gems: number; ownedCardIds: string[] }>;

  setHero: (id: HeroId, name: string) => void;
  setChapter: (ch: number) => void;
  /** 设置第二章子段标识（'a' / 'b' / ''）。仅在 chapter===2 时有意义。 */
  setStorySubChapter: (sub: '' | 'a' | 'b') => void;
  setSegmentIndex: (i: number) => void;
  addSpiritStones: (n: number) => void;
  addCard: (cardId: string) => void;
  addClue: (clue: string) => void;
  /** 添加结构化线索（S8 密谈 / S7A 合作清怪使用） */
  addClueEntry: (entry: Omit<ClueEntry, 'timestamp'>) => void;
  /** 标记某个话题已被问过（密谈去重） */
  markTopicAsked: (topicId: string) => void;
  /** 记录某个主角被密谈的次数+1 */
  recordNegotiationWith: (heroId: HeroId) => void;
  /** 增加某阵营好感（未来摇摆位判断用） */
  addFactionAffinity: (faction: 'A' | 'B', delta: number) => void;
  /** 标记当前章剧情已读完 */
  markStoryDone: (ch: number) => void;
  /** 标记当前章玩法环节已完成（解锁下一章） */
  markPhaseDone: (ch: number) => void;
  /** 检查某章是否可进入 */
  canEnterChapter: (ch: number) => boolean;

  // === S5 ===
  recordBattleResult: (won: boolean) => void;
  recordQuizResult: (correct: boolean) => void;
  setMentorship: (id: MentorshipId) => void;
  resetS5: () => void;

  // === 境界 ===
  /** @deprecated 仅用于旧的主角单一境界，保留兼容 */
  upgradeMentalLevel: () => boolean;
  /**
   * 提升指定角色卡的境界（消耗5灵石，三维各+1）
   * @param cardId 角色卡id
   * @param currentRealm 该角色当前初始境界（从配置读取）
   * @returns 是否成功
   */
  upgradeCardRealm: (cardId: string, currentRealm: string) => boolean;
  /** 获取指定卡牌的加成 */
  getCardBonus: (cardId: string) => CardBonus;
  /**
   * 给所有 AI 主角批量发放拜师加成（按 AI_MENTORSHIP_TABLE）。
   * 玩家完成 S5c 后由 applyAiMentorships 一次性调用，重复调用幂等。
   */
  applyAiMentorships: () => void;
  /**
   * 给所有 AI 主角批量执行境界提升（不消耗灵石），让 cardBonuses[aiHeroId]
   * 的 realmUps 达到目标次数。重复调用幂等。
   * @param targetUps 目标累计提升次数（由章节决定）
   */
  applyAiRealmUps: (targetUps: number) => void;
  /** 标记当前章招募已完成 */
  markRecruitDone: () => void;
  /** 写入剿匪战（S7A）玩家击杀数（0~8）— 决定 S6b 抽卡顺序 */
  setBanditKillCount: (n: number) => void;
  /** 写入 S6b 结束后剩余的 SR 卡 id 列表（供 S6c 精英池合并使用） */
  setPool2RemainingSr: (ids: string[]) => void;
  /**
   * 设置最终决战阵容站边（S8c 结束时写入）。
   * 同时根据主角身份自动计算并写入 swingAssignment：
   *   - 主角=寒立：玩家选 X → 寒立去 X，旺林去反阵
   *   - 主角=旺林：玩家选 X → 旺林去 X，寒立去反阵
   *   - 其他主角：寒立和旺林随机分执两端
   */
  setFinalFaction: (f: 'A' | 'B') => void;

  /**
   * 写入 S7D 备战阶段玩家挑选的 5 张参战卡（不含主角）。
   * 传入 null 清空（用于重置/测试）。
   */
  setS7DDeployedCards: (ids: string[] | null) => void;

  /**
   * 写入 S7D 首发登场阶段玩家选定的 2 张首发卡。
   * 必须是 [主角 + s7dDeployedCards 5 张] 的子集，长度为 2。
   * 传入 null 清空（用于重置/测试）。
   */
  setS7DStarters: (ids: string[] | null) => void;

  /**
   * 写入 S7D 5 个 AI 主角的阵容快照。
   * 由 S7D_PreBattle 首次进入时调用，避免每次进入都重算。
   * 传入 null 清空（强制下次重算）。
   */
  setS7DAiLineups: (lineups: Record<string, { heroId: HeroId; faction: 'A' | 'B'; deployedCards: string[]; starterCards: string[] }> | null) => void;

  /**
   * 写入 S7D 决战最终结果。
   * 由 S7D_Battle 战斗结算时调用，传入 outcome + endReason，自动打上时间戳。
   * 传入 null 可清空（用于再战/重置）。
   */
  setS7DFinalResult: (result: Omit<S7DFinalResult, 'timestamp'> | null) => void;

  /** 写入 S6 招募结束后 AI 道友的灵石与已抽卡快照（跨轮继承用）。传入 null 或空对象清空。 */
  setAiRecruitState: (state: Record<string, { gems: number; ownedCardIds: string[] }> | null) => void;

  loadFromSave: (s: SaveSlot) => void;
  reset: () => void;
}

const INITIAL_S5: S5Progress = {
  battlePassed: 0,
  battleWon: 0,
  quizAnswered: 0,
  quizCorrect: 0,
  mentorship: null,
};

const initial = {
  heroId: null as HeroId | null,
  heroName: '',
  chapter: 1,
  storySubChapter: '' as '' | 'a' | 'b',
  segmentIndex: 0,
  spiritStones: 0,
  ownedCardIds: [] as string[],
  clues: [] as string[],
  clueEntries: [] as ClueEntry[],
  negotiationAskedTopics: [] as string[],
  negotiationTalkedTimes: {} as Partial<Record<HeroId, number>>,
  factionAffinity: { A: 0, B: 0 },
  chapterProgress: {
    1: { storyDone: false, phaseDone: false },
  } as Record<number, ChapterProgress>,
  s5: { ...INITIAL_S5 },
  battleBonus: 0,
  knowledgeBonus: 0,
  aiMentorship: {} as Partial<Record<HeroId, MentorshipId>>,
  mentalLevel: '凡人' as '凡人' | '炼气' | '筑基' | '结丹',
  cardBonuses: {} as Record<string, CardBonus>,
  recruitDone: false,
  lastBanditKillCount: -1,
  pool2RemainingSr: [] as string[],
  finalFaction: null as 'A' | 'B' | null,
  swingAssignment: null as { hanli: 'A' | 'B'; wanglin: 'A' | 'B' } | null,
  s7dDeployedCards: null as string[] | null,
  s7dStarters: null as string[] | null,
  s7dAiLineups: null as Record<string, { heroId: HeroId; faction: 'A' | 'B'; deployedCards: string[]; starterCards: string[] }> | null,
  s7dFinalResult: null as S7DFinalResult | null,
  aiRecruitState: {} as Record<string, { gems: number; ownedCardIds: string[] }>,
};

/** 境界提升统一消耗灵石数 */
export const REALM_UPGRADE_COST = 5;
/** 境界阶梯（用于判断是否已满级） */
export const REALM_ORDER = ['凡人', '炼气', '筑基', '结丹'] as const;

/** 判断某个角色基于初始境界+已提升次数后是否已达到结丹 */
export function getRealmAfterUps(baseRealm: string, realmUps: number): string {
  const idx = REALM_ORDER.indexOf(baseRealm as any);
  if (idx === -1) return baseRealm;
  const newIdx = Math.min(idx + realmUps, REALM_ORDER.length - 1);
  return REALM_ORDER[newIdx];
}

/** 判断角色是否可继续提升（未达结丹） */
export function canUpgradeRealm(baseRealm: string, realmUps: number): boolean {
  const idx = REALM_ORDER.indexOf(baseRealm as any);
  if (idx === -1) return false;
  return idx + realmUps < REALM_ORDER.length - 1;
}

/** 境界提升所需灵石（按策划：凡人→炼气 3，炼气→筑基 5，筑基→结丹 8） */
const LEVEL_COST: Record<string, number> = {
  凡人: 3,
  炼气: 5,
  筑基: 8,
};
const LEVEL_ORDER = ['凡人', '炼气', '筑基', '结丹'] as const;

const EMPTY_BONUS: CardBonus = { hp: 0, atk: 0, mnd: 0, realmUps: 0 };

export const useGameStore = create<GameState>((set, get) => ({
  ...initial,
  setHero: (id, name) => set({ heroId: id, heroName: name }),
  setChapter: (ch) => set({ chapter: ch, segmentIndex: 0, recruitDone: false, storySubChapter: '' }),
  setStorySubChapter: (sub) => set({ storySubChapter: sub, segmentIndex: 0 }),
  setSegmentIndex: (i) => set({ segmentIndex: i }),
  addSpiritStones: (n) => set((s) => ({ spiritStones: Math.max(0, s.spiritStones + n) })),
  addCard: (cardId) => set((s) => ({
    ownedCardIds: s.ownedCardIds.includes(cardId) ? s.ownedCardIds : [...s.ownedCardIds, cardId],
  })),
  addClue: (clue) => set((s) => ({
    clues: s.clues.includes(clue) ? s.clues : [...s.clues, clue],
  })),

  addClueEntry: (entry) => set((s) => {
    if (s.clueEntries.some((e) => e.id === entry.id)) return {};
    return {
      clueEntries: [...s.clueEntries, { ...entry, timestamp: Date.now() }],
      // 同时写入旧 clues 字段保持兼容
      clues: s.clues.includes(entry.title) ? s.clues : [...s.clues, entry.title],
    };
  }),

  markTopicAsked: (topicId) => set((s) => ({
    negotiationAskedTopics: s.negotiationAskedTopics.includes(topicId)
      ? s.negotiationAskedTopics
      : [...s.negotiationAskedTopics, topicId],
  })),

  recordNegotiationWith: (heroId) => set((s) => ({
    negotiationTalkedTimes: {
      ...s.negotiationTalkedTimes,
      [heroId]: (s.negotiationTalkedTimes[heroId] ?? 0) + 1,
    },
  })),

  addFactionAffinity: (faction, delta) => set((s) => ({
    factionAffinity: {
      ...s.factionAffinity,
      [faction]: s.factionAffinity[faction] + delta,
    },
  })),

  markStoryDone: (ch) => set((s) => ({
    chapterProgress: {
      ...s.chapterProgress,
      [ch]: { ...s.chapterProgress[ch], storyDone: true },
    },
  })),

  markPhaseDone: (ch) => set((s) => ({
    chapterProgress: {
      ...s.chapterProgress,
      [ch]: { ...s.chapterProgress[ch], storyDone: true, phaseDone: true },
      // 初始化下一章进度
      [ch + 1]: s.chapterProgress[ch + 1] ?? { storyDone: false, phaseDone: false },
    },
  })),

  canEnterChapter: (ch) => {
    if (ch <= 1) return true;
    const prev = get().chapterProgress[ch - 1];
    // 上一章的剧情和玩法环节都完成才能进入下一章
    // 特殊：ch1只需要剧情读完（没有玩法环节），自动解锁ch2
    if (ch === 2) return prev?.storyDone ?? false;
    return prev?.phaseDone ?? false;
  },

  // === S5 流程 ===
  recordBattleResult: (won) => set((s) => ({
    s5: {
      ...s.s5,
      battlePassed: s.s5.battlePassed + 1,
      battleWon: s.s5.battleWon + (won ? 1 : 0),
    },
  })),
  recordQuizResult: (correct) => set((s) => ({
    s5: {
      ...s.s5,
      quizAnswered: s.s5.quizAnswered + 1,
      quizCorrect: s.s5.quizCorrect + (correct ? 1 : 0),
    },
  })),
  setMentorship: (id) => set((s) => ({
    s5: { ...s.s5, mentorship: id },
    // 御敌堂 → 修为 +1
    battleBonus: id === 'yudi' ? s.battleBonus + 1 : s.battleBonus,
    // 藏经阁 → 心境 +1
    knowledgeBonus: id === 'danyao' ? s.knowledgeBonus + 1 : s.knowledgeBonus,
  })),
  resetS5: () => set({ s5: { ...INITIAL_S5 } }),

  // === 境界提升（旧：主角单一境界，保留兼容） ===
  upgradeMentalLevel: () => {
    const s = get();
    const currentIdx = LEVEL_ORDER.indexOf(s.mentalLevel);
    if (currentIdx === -1 || currentIdx >= LEVEL_ORDER.length - 1) return false;
    const cost = LEVEL_COST[s.mentalLevel];
    if (s.spiritStones < cost) return false;
    set({
      spiritStones: s.spiritStones - cost,
      mentalLevel: LEVEL_ORDER[currentIdx + 1],
    });
    return true;
  },

  // === 新：任意角色卡境界提升 ===
  upgradeCardRealm: (cardId, currentRealm) => {
    const s = get();
    if (s.spiritStones < REALM_UPGRADE_COST) return false;
    const existing = s.cardBonuses[cardId] ?? { ...EMPTY_BONUS };
    if (!canUpgradeRealm(currentRealm, existing.realmUps)) return false;
    set({
      spiritStones: s.spiritStones - REALM_UPGRADE_COST,
      cardBonuses: {
        ...s.cardBonuses,
        [cardId]: {
          hp: existing.hp + 1,
          atk: existing.atk + 1,
          mnd: existing.mnd + 1,
          realmUps: existing.realmUps + 1,
        },
      },
      // 如果是主角卡，同步更新 mentalLevel（兼容旧逻辑）
      ...(cardId === s.heroId
        ? { mentalLevel: getRealmAfterUps(currentRealm, existing.realmUps + 1) as any }
        : {}),
    });
    return true;
  },

  getCardBonus: (cardId) => {
    return get().cardBonuses[cardId] ?? EMPTY_BONUS;
  },

  applyAiMentorships: () => set((s) => {
    // 幂等：如果已经有任何 AI 拜师记录，直接返回（避免重复加成）
    if (Object.keys(s.aiMentorship).length > 0) return {};
    const next: Partial<Record<HeroId, MentorshipId>> = {};
    for (const [heroId, mentorId] of Object.entries(AI_MENTORSHIP_TABLE)) {
      // 跳过玩家自己（玩家走 setMentorship 路径）
      if (heroId === s.heroId) continue;
      next[heroId as HeroId] = mentorId as MentorshipId;
    }
    return { aiMentorship: next };
  }),

  applyAiRealmUps: (targetUps: number) => set((s) => {
    if (!Number.isFinite(targetUps) || targetUps <= 0) return {};
    const nextBonuses = { ...s.cardBonuses };
    for (const hero of HEROES_DATA) {
      // 跳过玩家自己（玩家通过 upgradeCardRealm 主动提升）
      if (hero.id === s.heroId) continue;
      const existing = nextBonuses[hero.id] ?? { ...EMPTY_BONUS };
      // 当前已提升次数 < 目标次数 才需要补；同时不能超过飞升上限
      let ups = existing.realmUps;
      while (ups < targetUps && canUpgradeRealm(hero.realm, ups)) {
        ups += 1;
      }
      const delta = ups - existing.realmUps;
      if (delta > 0) {
        nextBonuses[hero.id] = {
          hp: existing.hp + delta,
          atk: existing.atk + delta,
          mnd: existing.mnd + delta,
          realmUps: ups,
        };
      }
    }
    return { cardBonuses: nextBonuses };
  }),

  markRecruitDone: () => set({ recruitDone: true }),

  setBanditKillCount: (n) => set({ lastBanditKillCount: Math.max(0, Math.min(8, Math.floor(n))) }),

  setPool2RemainingSr: (ids) => set({ pool2RemainingSr: Array.isArray(ids) ? ids.slice() : [] }),

  setFinalFaction: (f) => set((s) => {
    const faction: 'A' | 'B' = f === 'B' ? 'B' : 'A';
    const opposite: 'A' | 'B' = faction === 'A' ? 'B' : 'A';
    let assignment: { hanli: 'A' | 'B'; wanglin: 'A' | 'B' };
    if (s.heroId === 'hero_hanli') {
      // 玩家=寒立：寒立跟随玩家选择，旺林反阵
      assignment = { hanli: faction, wanglin: opposite };
    } else if (s.heroId === 'hero_wanglin') {
      // 玩家=旺林：旺林跟随玩家选择，寒立反阵
      assignment = { hanli: opposite, wanglin: faction };
    } else {
      // 玩家=塘散/小舞儿/萧焱/薰儿：寒立和旺林随机分执两端
      const hanliGoA = Math.random() < 0.5;
      assignment = {
        hanli: hanliGoA ? 'A' : 'B',
        wanglin: hanliGoA ? 'B' : 'A',
      };
    }
    return { finalFaction: faction, swingAssignment: assignment };
  }),

  setS7DDeployedCards: (ids) => set({
    s7dDeployedCards: Array.isArray(ids) ? ids.slice() : null,
  }),

  setS7DStarters: (ids) => set({
    s7dStarters: Array.isArray(ids) ? ids.slice() : null,
  }),

  setS7DAiLineups: (lineups) => set({
    s7dAiLineups: lineups && typeof lineups === 'object' ? { ...lineups } : null,
  }),

  setS7DFinalResult: (result) => set({
    s7dFinalResult: result ? { ...result, timestamp: Date.now() } : null,
  }),

  setAiRecruitState: (state) => set({
    aiRecruitState: state && typeof state === 'object' && !Array.isArray(state) ? { ...state } : {},
  }),

  loadFromSave: (s) =>
    set({
      heroId: s.heroId,
      heroName: s.heroName,
      chapter: s.chapter,
      storySubChapter: (() => {
        const v = (s as any).storySubChapter;
        return (v === 'a' || v === 'b') ? v : '';
      })(),
      segmentIndex: s.segmentIndex,
      spiritStones: s.spiritStones,
      ownedCardIds: s.ownedCardIds,
      clues: s.clues,
      clueEntries: (s as any).clueEntries ?? [],
      negotiationAskedTopics: (s as any).negotiationAskedTopics ?? [],
      negotiationTalkedTimes: (s as any).negotiationTalkedTimes ?? {},
      factionAffinity: (s as any).factionAffinity ?? { A: 0, B: 0 },
      chapterProgress: (s as any).chapterProgress ?? initial.chapterProgress,
      s5: (s as any).s5 ?? { ...INITIAL_S5 },
      battleBonus: (s as any).battleBonus ?? 0,
      knowledgeBonus: (s as any).knowledgeBonus ?? 0,
      aiMentorship: (() => {
        const v = (s as any).aiMentorship;
        return v && typeof v === 'object' && !Array.isArray(v) ? { ...v } : {};
      })(),
      mentalLevel: (s as any).mentalLevel ?? '凡人',
      cardBonuses: (s as any).cardBonuses ?? {},
      recruitDone: (s as any).recruitDone ?? false,
      lastBanditKillCount: (s as any).lastBanditKillCount ?? -1,
      pool2RemainingSr: Array.isArray((s as any).pool2RemainingSr) ? (s as any).pool2RemainingSr : [],
      finalFaction: ((s as any).finalFaction === 'A' || (s as any).finalFaction === 'B') ? (s as any).finalFaction : null,
      swingAssignment: (() => {
        const sa = (s as any).swingAssignment;
        if (sa && (sa.hanli === 'A' || sa.hanli === 'B') && (sa.wanglin === 'A' || sa.wanglin === 'B')) {
          return { hanli: sa.hanli, wanglin: sa.wanglin };
        }
        return null;
      })(),
      s7dDeployedCards: Array.isArray((s as any).s7dDeployedCards) ? (s as any).s7dDeployedCards : null,
      s7dStarters: Array.isArray((s as any).s7dStarters) ? (s as any).s7dStarters : null,
      s7dAiLineups: (() => {
        const v = (s as any).s7dAiLineups;
        if (v && typeof v === 'object' && !Array.isArray(v)) return { ...v };
        return null;
      })(),
      s7dFinalResult: (() => {
        const v = (s as any).s7dFinalResult;
        if (v && typeof v === 'object' && (v.outcome === 'victory' || v.outcome === 'defeat' || v.outcome === 'draw')) {
          return {
            outcome: v.outcome,
            endReason: typeof v.endReason === 'string' ? v.endReason : 'unknown',
            timestamp: typeof v.timestamp === 'number' ? v.timestamp : Date.now(),
            bigRoundAtEnd: typeof v.bigRoundAtEnd === 'number' ? v.bigRoundAtEnd : undefined,
            killsCount: typeof v.killsCount === 'number' ? v.killsCount : undefined,
            deathsCount: typeof v.deathsCount === 'number' ? v.deathsCount : undefined,
          } as S7DFinalResult;
        }
        return null;
      })(),
      aiRecruitState: (() => {
        const v = (s as any).aiRecruitState;
        if (v && typeof v === 'object' && !Array.isArray(v)) return { ...v };
        return {};
      })(),
    }),
  reset: () => set(initial),
}));

// === 存档接口 ===
const SAVE_KEY_PREFIX = 'cardwar_save_';
/** 自动存档槽位 ID（"返回主菜单"时自动写入；不与玩家手动槽位 1/2/3 冲突） */
export const AUTO_SAVE_SLOT = 0;

export const SaveSystem = {
  save(slot: number): void {
    const s = useGameStore.getState();
    if (!s.heroId) return;
    const data = {
      slot,
      timestamp: new Date().toISOString(),
      heroId: s.heroId,
      heroName: s.heroName,
      chapter: s.chapter,
      storySubChapter: s.storySubChapter,
      segmentIndex: s.segmentIndex,
      spiritStones: s.spiritStones,
      ownedCardIds: s.ownedCardIds,
      clues: s.clues,
      clueEntries: s.clueEntries,
      negotiationAskedTopics: s.negotiationAskedTopics,
      negotiationTalkedTimes: s.negotiationTalkedTimes,
      factionAffinity: s.factionAffinity,
      chapterProgress: s.chapterProgress,
      s5: s.s5,
      battleBonus: s.battleBonus,
      knowledgeBonus: s.knowledgeBonus,
      aiMentorship: s.aiMentorship,
      mentalLevel: s.mentalLevel,
      cardBonuses: s.cardBonuses,
      recruitDone: s.recruitDone,
      lastBanditKillCount: s.lastBanditKillCount,
      pool2RemainingSr: s.pool2RemainingSr,
      finalFaction: s.finalFaction,
      swingAssignment: s.swingAssignment,
      s7dFinalResult: s.s7dFinalResult,
      aiRecruitState: s.aiRecruitState,
    };
    localStorage.setItem(`${SAVE_KEY_PREFIX}${slot}`, JSON.stringify(data));
  },

  /**
   * 自动存档：写入专用槽位 0（不影响玩家手动槽位 1/2/3）。
   * 触发场景：玩家在游戏中任意页面点击"返回主菜单"。
   * 若当前未选角（heroId 为空），则不存档（避免空数据覆盖）。
   * @returns 是否成功写入
   */
  autoSave(): boolean {
    const s = useGameStore.getState();
    if (!s.heroId) return false;
    this.save(AUTO_SAVE_SLOT);
    return true;
  },

  load(slot: number): SaveSlot | null {
    const raw = localStorage.getItem(`${SAVE_KEY_PREFIX}${slot}`);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as SaveSlot;
    } catch {
      return null;
    }
  },

  /** 仅返回手动存档槽 1/2/3（与原行为保持兼容） */
  getAllSlots(): (SaveSlot | null)[] {
    return [1, 2, 3].map((s) => this.load(s));
  },

  /** 读取自动存档（返回主菜单时写入的最近进度） */
  getAutoSlot(): SaveSlot | null {
    return this.load(AUTO_SAVE_SLOT);
  },

  hasSaves(): boolean {
    return this.getAllSlots().some((s) => s !== null) || this.getAutoSlot() !== null;
  },

  delete(slot: number): void {
    localStorage.removeItem(`${SAVE_KEY_PREFIX}${slot}`);
  },
};