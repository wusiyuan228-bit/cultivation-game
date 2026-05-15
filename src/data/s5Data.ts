/**
 * S5 入门测试相关可配置数据
 * 来源：02_策划文档/核心玩法流程.md（3.2 第二章·拜师入门）
 *       02_策划文档/UI交互设计文档.md（S5a/S5b/S5c）
 *
 * 此文件可被策划直接编辑调整数值，不涉及逻辑。
 */
import type { MentorshipOption, BattleOpponent } from '@/types/game';
import { asset } from '@/utils/assetPath';

/** 拜师部门三选一（数值见核心玩法流程.md） */
export const MENTORSHIP_OPTIONS: MentorshipOption[] = [
  {
    id: 'yudi',
    name: '御敌堂',
    master: '铁峰',
    mastertTitle: '武堂主',
    reward: { spiritStones: 5, atkBonus: 1 },
    bonus: '修为 +1 · 灵石 ×5',
    suitableFor: '适合战斗向玩家',
    accent: '#b8502f', // 体修·赤铜
    masterPortrait: asset('images/stage/s5_master_yudi.jpg'),
    masterQuote: '习武不是逞凶斗狠，是为护身边人。看清楚自己的拳，再来寻我。',
  },
  {
    id: 'danyao',
    name: '藏经阁',
    master: '苏灵',
    mastertTitle: '阁主',
    reward: { spiritStones: 5, mndBonus: 1 },
    bonus: '心境 +1 · 灵石 ×5',
    suitableFor: '适合社交/辅助向玩家',
    accent: '#c88b2f', // 丹修·丹橙
    masterPortrait: asset('images/stage/s5_master_danyao.jpg'),
    masterQuote: '心若不静，万卷皆为废纸。我教的是看天，看地，看自己。',
  },
  {
    id: 'caiyao',
    name: '炼丹堂',
    master: '青木',
    mastertTitle: '苑主',
    reward: { spiritStones: 10 },
    bonus: '灵石 ×10',
    suitableFor: '适合抽卡向玩家',
    accent: '#7ba85f', // 灵修·青绿
    masterPortrait: asset('images/stage/s5_master_caiyao.jpg'),
    masterQuote: '炼丹三分火候七分耐性。世人都想一步登天，可我这炉子，等得起的人才进得来。',
  },
];

/**
 * S5a 入门战斗考核：2 位 AI 对手（修为/气血/心境各不同）
 * 数据来源：核心玩法流程·事件1/事件2（修为偏高 vs 气血偏高）
 * 二面骰制 v2.0：骰子数 = 修为值
 */
export const S5_BATTLE_OPPONENTS: BattleOpponent[] = [
  {
    id: 'npc_examiner_jia',
    name: '考核官甲',
    type: '剑修',
    hp: 3,
    atk: 5, // 修为偏高
    mnd: 3,
    portrait: asset('images/stage/s5_examiner_jian.jpg'),
    intro: '一名修为偏高的剑修师兄。修为高 = 骰子多，但上限也取决于运气。',
  },
  {
    id: 'npc_examiner_yi',
    name: '考核官乙',
    type: '体修',
    hp: 9,
    atk: 2, // 气血偏高，修为低
    mnd: 2,
    portrait: asset('images/stage/s5_examiner_ti.jpg'),
    intro: '一名气血雄厚的体修师兄。修为低但血厚，需要更多回合才能击败。',
  },
];

/** S5a 每场胜负的奖励（策划可调） */
export const S5_BATTLE_REWARDS = {
  win: 5,      // 灵石×5
  lose: 2,     // 灵石×2（保底）
};

/** S5b 每题胜负奖励（策划可调） */
export const S5_QUIZ_REWARDS = {
  correct: 5,
  wrong: 2,
  clueOnCorrect: false, // 理论考核只奖励灵石，无线索
};

/** S5b 共答几道题 */
export const S5_QUIZ_COUNT = 2;

/** S5a 教学说明文字（策划可配置） */
export const S5A_BANNER_TEXT = '';
/** 战斗机制说明（上下两行展示） */
export const S5A_RULE_LINE1 =
  '战斗机制：造成伤害 = 我方掷出骰子的点数和 − 敌方掷出骰子的点数和';
export const S5A_RULE_LINE2 =
  '（骰子数量 = 修为值，最低造成 1 点伤害）';
/** @deprecated 保留兼容性，使用 S5A_RULE_LINE1/LINE2 */
export const S5A_RULE_TEXT = `${S5A_RULE_LINE1} ${S5A_RULE_LINE2}`;

/** S5b 标题 */
export const S5B_TITLE = '理论考核';
export const S5B_SUBTITLE = '修仙知识';
export const S5C_TITLE = '拜师入门';
