/**
 * 仙战·天渊篇 — 核心类型定义
 * 来源：02_策划文档/卡牌角色总表.md + public/config/cards/cards_all.json
 */

export type CultivationType = '剑修' | '体修' | '妖修' | '法修' | '丹修' | '灵修';

export type Faction = 'A' | 'B' | '摇摆';

export type HeroId =
  | 'hero_hanli'
  | 'hero_tangsan'
  | 'hero_xiaowu'
  | 'hero_xiaoyan'
  | 'hero_xuner'
  | 'hero_wanglin';

export interface Skill {
  name: string;
  desc: string;
  /**
   * 技能类型：
   *  - secret  密谈技能（仅6名主角有，在跑团密谈环节生效，决战章隐藏）
   *  - recruit 招募技能（主角和R卡可能有，仅抽卡阶段生效，决战章隐藏）
   *  - battle  战斗技能（R/SR/SSR可能有，S7战棋阶段才揭晓，S7前显示"暂未揭晓"）
   *  - awaken  觉醒技能（个别角色有，战斗中满足条件揭晓）
   *  - run / battle 为早期兼容类型（等价于 secret / battle），新代码请用新命名
   */
  type: 'secret' | 'recruit' | 'battle' | 'awaken' | 'run';
  /** 抽卡技能分类（仅招募技能使用） */
  category?: string;
  /** 技能参数（count/reduce/reward/extraCost/targetType/rerollRarity/threshold/ip/gender 等） */
  params?: Record<string, any>;
}

export interface CardStats {
  hp: number;
  atk: number;
  mnd: number;
  skills: {
    run_skill: Skill | null;
    battle_skill: Skill | null;
    ultimate?: Skill | null;
  };
}

export interface Hero {
  id: HeroId;
  name: string;
  tribute: string;
  rarity: '主角';
  ip: string;
  type: CultivationType;
  gender: string;
  faction: Faction;
  realm: string;
  realm_level: number;
  max_realm: string;
  max_realm_level: number;
  /**
 * 宗门剿匪（S7A）假设击杀数（6~8），仅用于 S6b 抽卡顺序排序。
   * 玩家角色以 gameStore.lastBanditKillCount 的真实击杀数覆盖此预设。
   */
  s7aKillMock?: number;
  run_card: CardStats;
  battle_card: CardStats;
  awakening: {
    name: string;
    trigger: string;
    /** 觉醒态立绘 id（imageCache 里的 key，如 hero_tangsan_awaken） */
    image?: string;
    hp: number;
    atk: number;
    mnd: number;
    skills: {
      run_skill?: Skill | null;
      battle_skill?: Skill | null;
      ultimate?: Skill | null;
    };
  };
}

export interface CardsAllData {
  version: string;
  date: string;
  total_cards: number;
  heroes: Hero[];
  [key: string]: unknown;
}

// === S4 剧情 ===

export interface StorySegment {
  id: string;
  type: 'narration' | 'dialogue' | 'choice';
  tag?: string;
  speaker: string | null;
  text: string;
  simplified?: string;
  character_portrait?: string;
  emotion?: string;
}

export interface StoryData {
  version: string;
  character: string;
  chapter: number;
  chapter_title: string;
  total_segments: number;
  total_word_count?: number;
  segments: StorySegment[];
  /** ch6 三态结局（victory/defeat/draw）。仅 ch6 使用。 */
  endings?: {
    victory?: { title: string; segments: StorySegment[] };
    defeat?: { title: string; segments: StorySegment[] };
    draw?: { title: string; segments: StorySegment[] };
  };
}

// === S7D 决战战场结算 ===

/** S7D 决战最终结果（写入 gameStore，供 S4 ch6 渲染对应结局） */
export type S7DOutcome = 'victory' | 'defeat' | 'draw';

export interface S7DFinalResult {
  outcome: S7DOutcome;
  /** 结束原因：如 'crystal_broken' / 'all_dead' / 'timeout' / 'surrender' */
  endReason: string;
  /** 时间戳（ms） */
  timestamp: number;
  /** 可选：结束时大回合数、我方击杀/阵亡数等 */
  bigRoundAtEnd?: number;
  killsCount?: number;
  deathsCount?: number;
}

// === 存档 ===

export interface SaveSlot {
  slot: number;
  timestamp: string;
  heroId: HeroId;
  heroName: string;
  chapter: number;
  /**
   * 第二章子段标识（2026-05-13 新增，可选）。
   *   - 'a' 山门初见（测试前）
   *   - 'b' 入门余波（拜师后）
   *   - 不存在或 '' 视为无（兼容老存档）
   */
  storySubChapter?: '' | 'a' | 'b';
  segmentIndex: number;
  spiritStones: number;
  ownedCardIds: string[];
  clues: string[];
}

// === S5 入门测试 ===

/** 拜师部门 ID */
export type MentorshipId = 'yudi' | 'danyao' | 'caiyao';

export interface MentorshipOption {
  id: MentorshipId;
  name: string;              // 部门名，如 "御敌堂"
  master: string;            // 负责人
  mastertTitle: string;      // 头衔
  reward: {
    spiritStones: number;
    /** 修为+N（御敌堂） */
    atkBonus?: number;
    /** 心境+N（藏经阁） */
    mndBonus?: number;
    /** 兼容历史：如突破材料等文字描述 */
    extra?: string;
  };
  bonus: string;             // 附加效果文本
  suitableFor: string;       // 适合哪类玩家
  accent: string;            // 视觉主色
}

/** S5b 理综考核题目 */
export interface QuizQuestion {
  id: string;
  text: string;
  options: string[];
  answer: number;            // 0-3
  exclude_34: number[];      // 心境3-4时排除的选项索引
  exclude_5: number[];       // 心境5+时排除的选项索引
  source?: string;
}

export interface QuizQuestionsData {
  version: string;
  total_questions: number;
  note?: string;
  design_rule?: string;
  questions: QuizQuestion[];
}

/** S5a 战斗考核 AI 对手定义 */
export interface BattleOpponent {
  id: string;
  name: string;
  type: CultivationType;
  hp: number;
  atk: number;   // 修为（骰子数量）
  mnd: number;   // 心境
  portrait?: string;
  intro?: string;   // 登场介绍
}

// === S_RULE 规则弹窗 ===

export interface RuleSection {
  subtitle: string;
  text: string;
}

export interface RuleContent {
  title: string;
  sections: RuleSection[];
}

export interface RulesTextData {
  version: string;
  note?: string;
  coop_battle: RuleContent;
  arena_battle: RuleContent;
  final_battle: RuleContent & { faction_goals?: Record<string, string> };
}

export type RuleKey = 'coop_battle' | 'arena_battle' | 'final_battle' | 's5_entry';