/**
 * S8 密谈（Negotiation）数据配置 · v2
 *
 * 规则（以用户最新口述为准，覆盖策划文档 §5.4 坦诚度旧设计）：
 *   - 本主角心境 ≥ 对方心境 → 必定从对方"已获取线索池"中抽一条（未被自己获取过的）
 *   - 对方心境 > 本主角心境 → 50% 概率提供正确线索，50% 概率提供错误（伪造）线索
 *   - 密谈次数 = ⌈主角心境 ÷ 2⌉（策划文档 §5.1）
 *
 * 数据源：
 *   - 问题/答案：公共配置 /config/events/npc_dialogues.json (30组×3题=90题)
 *   - 心境值：heroesData.battle_card.mnd + gameStore.cardBonuses[id].mnd
 *   - 每位 AI 主角的"已知线索池"：按剧情阶段写死（见 AI_KNOWN_CLUES_BY_ROUND）
 */

import type { HeroId } from '@/types/game';
import { asset } from '@/utils/assetPath';

// ---- Hero 中英文名双向映射（npc_dialogues.json 用中文名做键） -------------
export const HERO_ID_TO_CN: Record<HeroId, string> = {
  hero_tangsan: '塘散',
  hero_xiaowu: '小舞儿',
  hero_xiaoyan: '萧焱',
  hero_xuner: '薰儿',
  hero_hanli: '寒立',
  hero_wanglin: '旺林',
};
export const HERO_CN_TO_ID: Record<string, HeroId> = Object.fromEntries(
  Object.entries(HERO_ID_TO_CN).map(([k, v]) => [v, k as HeroId]),
) as Record<string, HeroId>;

// ---- JSON 数据结构 ------------------------------------------------------
export interface NpcDialogueQuestion {
  id: string;
  text: string;
  honest_answer: string;
  evasive_answer: string;
  hidden_info: string;  // 这就是"线索标题"
}

export interface NpcDialogueGroup {
  asker: string;
  target: string;
  questions: NpcDialogueQuestion[];
}

export interface NpcDialoguesFile {
  version: string;
  note: string;
  dialogues: NpcDialogueGroup[];
}

// ---- JSON 加载器 & 查询工具 --------------------------------------------

let _cache: NpcDialoguesFile | null = null;

export async function loadNpcDialogues(): Promise<NpcDialoguesFile> {
  if (_cache) return _cache;
  const resp = await fetch(asset('config/events/npc_dialogues.json'));
  if (!resp.ok) throw new Error('加载密谈对话配置失败');
  const data = (await resp.json()) as NpcDialoguesFile;
  _cache = data;
  return data;
}

/** 查询：主角 asker 与 target 的对话组 */
export function findDialogueGroup(
  file: NpcDialoguesFile,
  askerId: HeroId,
  targetId: HeroId,
): NpcDialogueGroup | undefined {
  const askerCn = HERO_ID_TO_CN[askerId];
  const targetCn = HERO_ID_TO_CN[targetId];
  return file.dialogues.find(
    (g) => g.asker === askerCn && g.target === targetCn,
  );
}

// ---- AI 主角"已知线索池" --------------------------------------------
/**
 * 每位 AI 主角在不同密谈轮次「所持有的线索（hidden_info 子集）」
 * 这是用户规则里"对方已获取线索中的一条"的数据依据。
 *
 * 设计依据：剧情进展 —— 第三章末期（round=1）每人已掌握 2-3 条基础情报；
 *          第四章末期（round=2）在此基础上各新增 1-2 条；
 *          第五章末期（round=3，最终）全员几乎摊牌。
 *
 * 这些线索的文字就是 npc_dialogues.json 中 questions[].hidden_info 字段，
 * 保持字符串完全一致，便于跨主角问答时去重。
 */
export const AI_KNOWN_CLUES_BY_ROUND: Record<HeroId, Record<1 | 2 | 3, string[]>> = {
  hero_tangsan: {
    1: ['地底灵力与父亲的关联', '寂叔公的反常关注', '清心诀来自玄寂'],
    2: ['塘散的隐约怀疑', '封锁区域', '塘散的动摇'],
    3: ['地底异常', '清心诀的真实目的', '塘散的信息有限'],
  },
  hero_xiaowu: {
    1: ['化形丹的灵魂印记', '妖修身份', '小舞儿也感应到了地底灵力'],
    2: ['妖力波动', '灵魂印记', '化形丹来源'],
    3: ['监控事实', '寂叔公在操控感情', '小舞儿的决心', '小舞儿的保护欲'],
  },
  hero_xiaoyan: {
    1: ['异火熄灭和秘法', '风无痕', '童年羁绊'],
    2: ['秘法在消耗，修为在流失', '异火是被人废的', '风无痕在天渊宗'],
    3: ['秘法时限', '风无痕与萧焱的关系', '异火被废的阴谋', '异火与秘宝的关联'],
  },
  hero_xuner: {
    1: ['紫霜仙子被杀', '薰儿怀疑玄寂', '匿名线索'],
    2: ['调查师父死因', '师父去世的影响', '薰儿一直在为他准备'],
    3: ['谋杀', '匿名线索来源', '紫霜锁魂阵的能力和代价', '薰儿的决心'],
  },
  hero_hanli: {
    1: ['残卷功法的完整版', '寒立观察到了所有人的秘密', '寒立对玄寂的怀疑'],
    2: ['寒立的全局观察', '残卷功法', '寒立注意到了风无痕'],
    3: ['对玄寂的判断', '寒立守护小舞的秘密', '寒立的判断', '寒立看穿了旺林的压力'],
  },
  hero_wanglin: {
    1: ['逆天宗大阵的危机', '风无痕的匿名信', '旺林的摇摆立场'],
    2: ['师门危机', '萧家与逆天宗的渊源', '匿名信', '萧战与逆天老祖的关系'],
    3: ['侵蚀源头未知', '旺林的动摇', '无后备方案', '旺林在为可能的对立铺垫', '旺林的善意'],
  },
};

/** 获取某主角在"当前轮次及之前所有轮次"的累积已知线索（去重） */
export function getAccumulatedClueTitles(heroId: HeroId, upToRound: 1 | 2 | 3): string[] {
  const bucket = AI_KNOWN_CLUES_BY_ROUND[heroId];
  const set = new Set<string>();
  for (let r = 1 as 1 | 2 | 3; r <= upToRound; r = (r + 1) as 1 | 2 | 3) {
    const list = bucket[r as 1 | 2 | 3] ?? [];
    for (const t of list) set.add(t);
    if (r === upToRound) break;
  }
  return Array.from(set);
}

// ---- 伪线索（心境劣势时的错误情报）-------------------------------------
/**
 * 伪造线索池。当对方心境 > 我、且 50% 概率落到"假线索"分支时，
 * 系统从这里随机取一条看似合理但误导的信息给玩家。
 * 特意写成"指向错误的人 / 错误的结论"，玩家后续密谈会发现自相矛盾。
 */
export const FAKE_CLUES: string[] = [
  '听说逆天宗大阵的崩塌是塘家祖师当年布阵失误——所以塘散才被宗门拉进来还债。',
  '萧焱的异火是他自己炼丹失控烧掉的，和任何人都无关。',
  '紫霜仙子其实是自己选择陨落，根本没人害她——她是在替自家家主顶罪。',
  '后勤执事风无痕只是个普通管事，萧焱一直在找的人早已死在万妖谷。',
  '寒立铜镜里的两个"气机诡异之人"指的是塘散和旺林——他们两个才是最大的内鬼。',
  '寂叔公对小舞儿好，只是因为他收过小舞儿兄长二明的一份人情。',
  '薰儿古族血脉其实是骗局——她的师父是被她自己误杀的。',
  '天元秘宝不在天渊宗，而是在坠魔谷北面的逆天宗旧址。',
  '化形丹上的灵魂印记是小舞儿兄长二明留下的护身符，并不是监控。',
  '藏经阁第七层的完整功法其实是假的——真正的残篇在寂叔公手里。',
];

export function pickRandomFakeClue(seed?: number): string {
  const i = Math.floor((seed ?? Math.random()) * FAKE_CLUES.length) % FAKE_CLUES.length;
  return FAKE_CLUES[Math.abs(i)];
}

// ---- 密谈判定规则（新版） ----------------------------------------------

/** 密谈次数 = ⌈心境 ÷ 2⌉，保证至少 1 次 */
export function calcNegotiationCount(mnd: number): number {
  return Math.max(1, Math.ceil(mnd / 2));
}

/** 密谈判定结果 */
export type NegotiationResult =
  | { kind: 'truth'; clueTitle: string; honestAnswer: string; bonusClueTitle?: string; skillTag?: string }   // 必得真线索
  | { kind: 'truth_luck'; clueTitle: string; honestAnswer: string; bonusClueTitle?: string; skillTag?: string } // 50%中奖，得真线索
  | { kind: 'fake'; fakeClueText: string; evasiveAnswer: string }   // 50%不中，给假线索
  | { kind: 'no_clue'; evasiveAnswer: string };                     // 对方没有可给的新线索

/** 心心相印必得真言关系（双向 pair）：直接对话 100% 真线索，无视心境差 */
export const SPECIAL_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['hero_tangsan', 'hero_xiaowu'],
  ['hero_xiaoyan', 'hero_xuner'],
] as const;

/** 判断两位主角是否为心心相印关系（双向） */
export function isSpecialPair(askerId: string | null | undefined, targetId: string | null | undefined): boolean {
  if (!askerId || !targetId) return false;
  return SPECIAL_PAIRS.some(
    ([a, b]) => (askerId === a && targetId === b) || (askerId === b && targetId === a),
  );
}

/**
 * 按用户口述规则进行密谈判定
 * @param myMnd             主角战斗卡心境（含加成）
 * @param targetMnd         对方战斗卡心境（含加成）
 * @param targetKnownClues  对方当前轮次及之前累积的已知线索标题列表
 * @param myOwnedClues      主角当前已获取的所有线索标题（用于去重，避免重复给）
 * @param honestAnswer      该话题的 honest_answer
 * @param evasiveAnswer     该话题的 evasive_answer
 * @param hiddenInfo        该话题的 hidden_info（线索标题）
 * @param askerIsXiaowu     发起者是否小舞儿（妖力感知：心境劣势也必得真话）
 * @param askerIsXuner      发起者是否薰儿（古族血脉感应：得真话时额外再抽一条）
 * @param specialPair       是否为"心心相印"必得真言关系（如 唐三↔小舞、萧炎↔薰儿）
 */
export function judgeNegotiation(params: {
  myMnd: number;
  targetMnd: number;
  targetKnownClues: string[];
  myOwnedClueTitles: string[];
  honestAnswer: string;
  evasiveAnswer: string;
  hiddenInfo: string;
  rng?: () => number;
  askerIsXiaowu?: boolean;
  askerIsXuner?: boolean;
  specialPair?: boolean;
}): NegotiationResult {
  const rng = params.rng ?? Math.random;

  // 此话题的 hidden_info 必须在对方"已知池"里 —— 否则对方根本不知道，直接给 evasive
  const targetHasIt = params.targetKnownClues.includes(params.hiddenInfo);
  const alreadyOwned = params.myOwnedClueTitles.includes(params.hiddenInfo);

  /** 「薰儿·古族血脉感应」：得真话后，再从对方池抽一条未获取的新线索 */
  const pickXunerBonus = (excludeTitles: string[]): string | undefined => {
    if (!params.askerIsXuner) return undefined;
    const pool = params.targetKnownClues.filter(
      (c) => !params.myOwnedClueTitles.includes(c) && !excludeTitles.includes(c),
    );
    if (pool.length === 0) return undefined;
    return pool[Math.floor(rng() * pool.length)];
  };

  if (!targetHasIt) {
    // 对方自己都不知道，给出模糊回答；尝试从对方已知池再抽一条作为"替代"真话
    const available = params.targetKnownClues.filter(
      (c) => !params.myOwnedClueTitles.includes(c),
    );
    // 心境≥对方，或小舞儿发动妖力感知，或心心相印关系 → 可以从池子里强行抽一条
    const canForce = params.myMnd >= params.targetMnd || params.askerIsXiaowu || params.specialPair;
    if (canForce && available.length > 0) {
      const picked = available[Math.floor(rng() * available.length)];
      const bonus = pickXunerBonus([picked]);
      return {
        kind: 'truth',
        clueTitle: picked,
        honestAnswer: `（岔开话题）${params.honestAnswer}`,
        bonusClueTitle: bonus,
        skillTag: params.specialPair && params.myMnd < params.targetMnd
          ? '💞 心心相印：默契直达本心，必得真话'
          : params.askerIsXiaowu && params.myMnd < params.targetMnd
            ? '🦊 妖力感知发动：直接感知到对方内心隐情'
            : bonus ? '🌸 古族血脉感应：洞察额外隐情' : undefined,
      };
    }
    return { kind: 'no_clue', evasiveAnswer: params.evasiveAnswer };
  }

  // 核心规则：心境占优，或小舞儿发动妖力感知，或心心相印关系
  const effectiveAdvantage = params.myMnd >= params.targetMnd || params.askerIsXiaowu || params.specialPair;

  if (effectiveAdvantage) {
    // 必定获得：若本条未被获取则返回本条；否则从对方池抽一条未获取的
    const usingXiaowuSkill = params.askerIsXiaowu && params.myMnd < params.targetMnd;
    const usingSpecialPair = params.specialPair && params.myMnd < params.targetMnd;
    const buildSkillTag = (bonus: string | undefined) =>
      usingSpecialPair
        ? '💞 心心相印：默契直达本心，必得真话'
        : usingXiaowuSkill
          ? '🦊 妖力感知发动：直接感知到对方内心隐情'
          : bonus ? '🌸 古族血脉感应：洞察额外隐情' : undefined;
    if (!alreadyOwned) {
      const bonus = pickXunerBonus([params.hiddenInfo]);
      return {
        kind: 'truth',
        clueTitle: params.hiddenInfo,
        honestAnswer: params.honestAnswer,
        bonusClueTitle: bonus,
        skillTag: buildSkillTag(bonus),
      };
    }
    const fallback = params.targetKnownClues.filter(
      (c) => !params.myOwnedClueTitles.includes(c),
    );
    if (fallback.length === 0) {
      return { kind: 'no_clue', evasiveAnswer: '（你已经知道对方的所有情报了）' };
    }
    const picked = fallback[Math.floor(rng() * fallback.length)];
    const bonus = pickXunerBonus([picked]);
    return {
      kind: 'truth',
      clueTitle: picked,
      honestAnswer: `（继续追问后）${params.honestAnswer}`,
      bonusClueTitle: bonus,
      skillTag: buildSkillTag(bonus),
    };
  } else {
    // 对方心境 > 我（且非小舞儿），50% 真 / 50% 假
    if (rng() < 0.5) {
      if (!alreadyOwned) {
        const bonus = pickXunerBonus([params.hiddenInfo]);
        return {
          kind: 'truth_luck',
          clueTitle: params.hiddenInfo,
          honestAnswer: params.honestAnswer,
          bonusClueTitle: bonus,
          skillTag: bonus ? '🌸 古族血脉感应：洞察额外隐情' : undefined,
        };
      }
      // 已获取过，给对方池中另一条
      const fallback = params.targetKnownClues.filter(
        (c) => !params.myOwnedClueTitles.includes(c),
      );
      if (fallback.length === 0) {
        return { kind: 'no_clue', evasiveAnswer: params.evasiveAnswer };
      }
      const picked = fallback[Math.floor(rng() * fallback.length)];
      const bonus = pickXunerBonus([picked]);
      return {
        kind: 'truth_luck',
        clueTitle: picked,
        honestAnswer: params.honestAnswer,
        bonusClueTitle: bonus,
        skillTag: bonus ? '🌸 古族血脉感应：洞察额外隐情' : undefined,
      };
    } else {
      return {
        kind: 'fake',
        fakeClueText: pickRandomFakeClue(rng()),
        evasiveAnswer: params.evasiveAnswer,
      };
    }
  }
}
