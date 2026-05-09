/**
 * S6 抽卡系统 — 类型定义
 *
 * 核心概念：
 * - 大轮（BigRound）：整个抽卡环节，6 人按顺序轮流抽卡，直到结束条件触发
 * - 小轮（DrawTurn）：单个参与者的一次抽卡机会
 * - 参与者（Participant）：玩家 或 AI（共6人）
 * - 抽卡代理（ActiveDrawer）：当前参与者选择用哪张卡来抽卡（主角卡或手上的 R 卡）
 */

import type { HeroId } from './game';

/** 卡牌稀有度 */
export type Rarity = 'N' | 'R' | 'SR' | 'SSR' | 'UR';

/** 卡牌 IP */
export type CardIP = '斗罗大陆' | '斗破苍穹' | '凡人修仙传' | '仙逆' | '原创';

/** 抽卡技能的分类 —— 决定触发时机和执行方式 */
export type RunSkillCategory =
  // T0 被动常驻
  | 'cost_reduce'          // 每次抽卡时灵石费用-N（薰儿/徐三石/林修涯/董萱儿）
  // T1 抽卡前 · 主动触发
  | 'preview_2'            // 抽2张选1 (小舞儿/独孤博/萧潇)
  | 'preview_3'            // 抽3张选1 (贝贝/青鳞)
  | 'extra_draw_paid'      // 额外消耗X灵石多抽1张 (萧焱/王卓/孙泰)
  | 'guarantee_highest'    // 消耗X灵石必定抽最高稀有度 (旺林)
  | 'designate_paid'       // 消耗X灵石从卡池指定一张 (蛮胡子)
  | 'same_ip_first'        // 优先抽同IP卡 (弗兰德/法犸/李化元/周茹)
  | 'prefer_female'        // 优先抽女性角色 (王蝉)
  | 'prefer_male'          // 优先抽男性角色 (魅姬)
  | 'free_draw_once'       // 本局免费抽1次 (宋玉)
  // T2 抽卡后 · 响应触发
  | 'return_for_gem'       // 放回换N灵石 (塘散)
  | 'reroll_n'             // 抽到N卡可放回重抽 (柳二龙/海波东)
  // T3 抽卡结算 · 自动生效
  | 'bonus_by_type'        // 抽到指定修士类型奖励灵石 (赵无极法修/辛如音剑修/即墨老人灵修)
  // T4 跳过专属
  | 'skip_reward'          // 跳过时获得灵石 (寒立/若琳)
  // T5 累积触发
  | 'accum_reward';        // 累计使用N次后奖励 (遁天)

/** 单个抽卡技能完整定义 */
export interface RunSkillDef {
  /** 技能名 */
  name: string;
  /** 策划描述 */
  desc: string;
  /** 归类 */
  category: RunSkillCategory;
  /** 配置参数（按category不同而不同） */
  params?: {
    /** cost_reduce: 减免的灵石数 */
    reduce?: number;
    /** preview_N: 抽取张数 */
    count?: number;
    /** extra_draw_paid/guarantee_highest/designate_paid: 额外消耗 */
    extraCost?: number;
    /** same_ip_first: 指定IP */
    ip?: CardIP;
    /** prefer_female/male: 性别 */
    gender?: '男' | '女';
    /** bonus_by_type: 条件修士类型 */
    targetType?: string;
    /** bonus_by_type/return_for_gem/skip_reward/accum_reward: 奖励灵石数 */
    reward?: number;
    /** reroll_n: 可重抽的稀有度 */
    rerollRarity?: Rarity;
    /** accum_reward: 累计次数 */
    threshold?: number;
  };
}

/**
 * 战斗技能/绝技 — 仅用于 UI 展示，不参与战斗逻辑
 * 真实战斗技能注册在 SkillRegistry 中，此处只承载文案
 */
export interface BattleSkillDisplay {
  name: string;
  desc: string;
  type?: string;       // passive / active / ultimate / autoModifier
  category?: string;
}

/** 一张完整的抽卡池中的卡牌（pool_1_nr中的每一张） */
export interface PoolCard {
  id: string;                     // 如 "R-1" "N-5"
  name: string;                   // 角色名
  tribute?: string;               // 致敬名
  rarity: Rarity;
  ip: CardIP;
  type: string;                   // 修士类型
  gender?: '男' | '女';
  realm: string;
  hp: number;
  atk: number;
  mnd: number;
  /** 跑团技能（N卡可能无，R/SSR有） */
  runSkill: RunSkillDef | null;
  /** 战斗技能（SR/SSR 有，仅展示用） */
  battleSkill?: BattleSkillDisplay | null;
  /** 主动绝技（SSR/部分SR 有，仅展示用） */
  ultimate?: BattleSkillDisplay | null;
  /** 是否为主角卡的战斗形态（对应6个主角） */
  isHeroBattleCard?: boolean;
}

/** 参与者（玩家/AI） */
export interface Participant {
  /** 唯一id，玩家是 heroId，AI 是 ai_xxx */
  id: string;
  /** 展示名 */
  name: string;
  /** 展示头像用的 HeroId（立绘） */
  portraitHeroId: HeroId;
  /** 是否玩家 */
  isPlayer: boolean;
  /** AI 风格（玩家不用） */
  aiStyle?: 'aggressive' | 'conservative' | 'balanced';
  /** 起始属性（用于决定抽卡顺序） */
  baseMnd: number;
  baseAtk: number;
  /**
   * 宗门剿匪（S7A）击杀数：
   *   - 玩家：使用 gameStore.lastBanditKillCount 的真实值
 *   - AI：使用 hero.s7aKillMock 的假设值（6~8）
   *   - 未经历过剿匪（例如 S6a）：全员 -1
   * 仅 S6b（pool=2）使用该字段决定抽卡顺序。
   */
  s7aKill: number;
  /** 当前灵石 */
  gems: number;
  /** 已用跳过次数 */
  skipUsed: number;
  /** 跳过总额度 */
  skipLimit: number;
  /** 当前抽卡代理卡的 id（主角卡/R卡） */
  activeCardId: string;
  /** 已拥有的所有卡（含初始主角卡） */
  ownedCards: PoolCard[];
  /** 本轮是否已替换过抽卡角色 */
  hasSwitchedThisTurn: boolean;
  /** 本轮抽到的 R 卡（下一轮才能换上使用技能） */
  rCardsDrawnThisTurn: string[];
  /** 累计技能触发次数（用于 accum_reward） */
  skillUseCount: Record<string, number>;
  /** 已使用的一次性技能（free_draw_once）*/
  usedOneshotSkills: string[];
  /** 本大轮 return_for_gem（塘散技能）已使用次数，每大轮重置（上限3） */
  returnForGemUsedThisBigRound: number;
  /** 是否已离场：跳过次数达到上限(3) 或 玩家主动离场 */
  hasLeft?: boolean;
}

/** 战报条目 */
export interface DrawLogEntry {
  id: string;
  timestamp: number;
  type: 'draw' | 'skip' | 'skill' | 'switch' | 'system' | 'reward';
  actor: string;     // 参与者 id
  text: string;      // 展示文字
}

/** 抽卡阶段 —— 驱动 UI 切换 */
export type RecruitPhase =
  | 'init'             // 初始化中
  | 'order_reveal'     // 展示抽卡顺序
  | 'turn_start'       // 某人轮次开始
  | 'skill_prompt'     // 等待技能使用决策
  | 'candidate_pick'   // 抽N选1的候选选择
  | 'designate_pick'   // 指定抽的卡池浏览
  | 'drawing'          // 抽卡动画中
  | 'post_draw_skill'  // 抽到后的技能响应（塘散等）
  | 'turn_end'         // 本轮结束
  | 'round_end'        // 大轮结束
  | 'ended';           // 整个抽卡环节结束

/** 抽卡系统的主状态 */
export interface RecruitState {
  phase: RecruitPhase;
  /** 招募是否已被玩家"开始"（false 时展示开始按钮，AI 不会自动抽卡） */
  recruitmentStarted: boolean;
  /** 所有6名参与者 */
  participants: Participant[];
  /** 抽卡顺序（存id） */
  drawOrder: string[];
  /** 当前轮到 drawOrder 中的第几位（0-5） */
  currentTurnIndex: number;
  /** 当前大轮次号 */
  bigRound: number;
  /** 卡池剩余 */
  pool: PoolCard[];
  /** 初始卡池大小 */
  initialPoolSize: number;
  /** 是否自动播放AI回合 */
  autoPlay: boolean;
  /** 战报 */
  log: DrawLogEntry[];
  /** 抽到的待展示卡（动画中） */
  pendingReveal: PoolCard | null;
  /** 候选卡（preview_N用） */
  candidates: PoolCard[];
  /** 刚抽到的卡（post_draw_skill阶段） */
  lastDrawnCard: PoolCard | null;
}

/** 抽卡费用计算参数 */
export interface DrawCostContext {
  baseCost: number;       // 池子的基础费用（NR池=5）
  participant: Participant;
  activeSkill: RunSkillDef | null;  // 当前激活角色的技能
}
