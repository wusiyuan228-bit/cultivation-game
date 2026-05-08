/**
 * S7B 技能元数据 & 名称映射
 *
 * 本文件有两份责任：
 *   1. 【兼容层】保留旧的 SKILLS_S7B 表（3 条 MVP 技能），让尚未迁移的调用点仍可工作
 *   2. 【新引擎桥接】提供 SKILL_NAME_TO_REGISTRY_ID，将技能中文名映射到
 *      新 SkillRegistry 中注册的技能 id（systems/battle/skills/*）
 *
 * 当一张 BattleUnit 被创建时：
 *   - unit.skillId  → 旧 id（向下兼容）
 *   - unit.skills[] → 新 id 列表，供 BattleEngine.resolveAttack 查询 hook
 */

export type SkillId =
  | 'skill_blueSilverCage'
  | 'skill_devourFlame'
  | 'skill_lifeSteal';

export type SkillTrigger =
  | 'active_attack'
  | 'passive_attack'
  | 'standalone';

export type SkillEffect =
  | { kind: 'target_immobilize_next_turn' }
  | { kind: 'target_atk_modify'; delta: number; floor: number }
  | { kind: 'self_atk_modify'; delta: number; cap: number | null }
  | { kind: 'self_hp_modify'; delta: number; breakMax: boolean };

export interface SkillDef {
  id: SkillId;
  name: string;
  trigger: SkillTrigger;
  diceMod: number;
  effects: SkillEffect[];
  hitLog: string;
}

export const SKILLS_S7B: Record<SkillId, SkillDef> = {
  skill_blueSilverCage: {
    id: 'skill_blueSilverCage',
    name: '蓝银囚笼',
    trigger: 'active_attack',
    diceMod: 0,
    effects: [{ kind: 'target_immobilize_next_turn' }],
    hitLog: '🔗 蓝银囚笼命中！{defender} 下一个行动轮无法移动',
  },
  skill_devourFlame: {
    id: 'skill_devourFlame',
    name: '焚决·噬焰',
    trigger: 'active_attack',
    diceMod: 0,
    effects: [
      { kind: 'target_atk_modify', delta: -1, floor: 1 },
      { kind: 'self_atk_modify', delta: +1, cap: null },
    ],
    hitLog: '🔥 焚决·噬焰触发！{defender} 修为-1，{attacker} 修为+1（可破上限）',
  },
  skill_lifeSteal: {
    id: 'skill_lifeSteal',
    name: '邪灵诀·夺命',
    trigger: 'active_attack',
    diceMod: 0,
    effects: [{ kind: 'self_hp_modify', delta: +1, breakMax: true }],
    hitLog: '🩸 邪灵诀·夺命触发！{attacker} 吸取 {defender} 1点气血',
  },
};

export const SKILL_NAME_TO_ID: Record<string, SkillId> = {
  蓝银囚笼: 'skill_blueSilverCage',
  '焚决·噬焰': 'skill_devourFlame',
  '邪灵诀·夺命': 'skill_lifeSteal',
};

export function getSkillDef(id: string | undefined): SkillDef | null {
  if (!id) return null;
  return SKILLS_S7B[id as SkillId] ?? null;
}

export function isImplementedSkill(id: string | undefined): boolean {
  return !!id && id in SKILLS_S7B;
}

/* ============================================================== */
/*  新引擎桥接（阶段 A P0 六条技能）                                */
/* ============================================================== */

/**
 * 技能中文名 → 新 SkillRegistry id
 * 这是 UI/store 层定位"这张卡挂哪些新引擎 hook"的唯一入口
 */
export const SKILL_NAME_TO_REGISTRY_ID: Record<string, string> = {
  // —— P0 六条（阶段 A 实装）——
  '昊天锤·碎': 'bssr_tanghao.battle',
  '修罗瞳·支配': 'hero_tangsan.awaken.battle',
  '萧族斗气·焚': 'ssr_xiaoxuan.battle',
  '焚决·噬焰': 'hero_xiaoyan.battle',
  '邪灵诀·夺命': 'hero_wanglin.battle',
  '噬金虫群': 'hero_hanli.awaken.battle',

  // —— 阶段 B：本体被动 3 条 ——
  '无敌金身': 'hero_xiaowu.battle',
  '青竹蜂云剑·七十二路': 'hero_hanli.battle',
  '古族血脉·共鸣': 'hero_xuner.battle',

  // —— 阶段 B：本体/觉醒 绝技 6 条 ——
  '修罗弑神击': 'hero_tangsan.awaken.ultimate',
  '佛怒火莲': 'hero_xiaoyan.ultimate',
  '万剑归宗': 'hero_hanli.ultimate',
  '逆·天地崩': 'hero_wanglin.ultimate',
  '金帝天火阵': 'hero_xuner.ultimate',
  '暗器·万毒淬体': 'hero_tangsan.ultimate',
  '八段摔·断魂': 'hero_xiaowu.ultimate',

  // —— 阶段 C：觉醒 8 条 + 本体蓝银囚笼 1 条 ——
  '蓝银囚笼': 'hero_tangsan.battle.cage',
  '柔骨·缠魂': 'hero_xiaowu.awaken.battle',
  '十万年魂骨献祭': 'hero_xiaowu.awaken.ultimate',
  '帝炎·焚天': 'hero_xiaoyan.awaken.battle',
  '帝品火莲·毁灭': 'hero_xiaoyan.awaken.ultimate',
  '斗帝血脉·庇护': 'hero_xuner.awaken.battle',
  '古族祖灵结界': 'hero_xuner.awaken.ultimate',
  '天罗万象·大衍决': 'hero_hanli.awaken.ultimate',
  '逆天·万魂幡': 'hero_wanglin.awaken.battle',
  '一念逆天': 'hero_wanglin.awaken.ultimate',
};

/** 根据技能中文名查找新引擎的 skill id（返回 undefined 表示该技能尚未实装） */
export function findRegistryIdByName(name: string | undefined | null): string | undefined {
  if (!name) return undefined;
  return SKILL_NAME_TO_REGISTRY_ID[name];
}
