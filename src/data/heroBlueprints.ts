/**
 * 主角双形态蓝图表（阶段 C · 觉醒系统）
 *
 * 为每位主角提供本体（base）和觉醒（awakened）两套 UnitBlueprint 数据。
 * 单位觉醒时由 `performAwakening()` 用 awakenData 原子替换：
 *   name / type / atk / mnd / hpCap / skills
 *   （instanceId / row / col / owner 保持不变）
 *
 * IP 标签 ipTag：用于萧焱觉醒触发判定（场上有3张+斗破角色）
 *   阶段 C 仅按主角本体判定；阶段 D 绑定 SSR 引入后再补（顾元/肖璇等 doupo）
 *
 * 数据来源：02_策划文档/主角系统_GDD.md + heroesData.ts
 *
 * 命名规则：
 *   - 觉醒前的 skills[] 指向 battle_skill 和 ultimate 的 registry id
 *   - 觉醒后的 skills[] 指向 awakening.battle_skill 和 awakening.ultimate 的 registry id
 */

import type { UnitBlueprint } from '@/systems/battle/types';
import type { CultivationType } from '@/types/game';

export type HeroIpTag = 'douluo' | 'doupo' | 'xianni';

export interface HeroBlueprint {
  heroId: string;
  name: string;
  ipTag: HeroIpTag;
  awakenTrigger: AwakenTriggerKind;
  base: UnitBlueprint;
  awakened: UnitBlueprint;
  /** 关联方标识（例如 "小舞儿" 觉醒会导致 "塘散" 也触发） */
  relatedHeroId?: string;
}

/** 6 条觉醒触发条件的字面量枚举 */
export type AwakenTriggerKind =
  | 'ally_xiaowu_leave'           // 塘散：小舞儿退场
  | 'self_hp_to_1'                // 小舞儿：气血降至1
  | 'doupo_count_ge_3'            // 萧焱：场上有3张+斗破角色
  | 'xuner_guyuan_hp_le_3'        // 薰儿：顾元在场时气血降至3以下
  | 'self_kill_count_ge_2'        // 寒立：累计击杀2名敌人
  | 'ally_situnan_leave';         // 旺林：司图楠退场

/** 6 位主角完整蓝图 */
export const HERO_BLUEPRINTS: Record<string, HeroBlueprint> = {
  hero_tangsan: {
    heroId: 'hero_tangsan',
    name: '塘散',
    ipTag: 'douluo',
    awakenTrigger: 'ally_xiaowu_leave',
    relatedHeroId: 'hero_xiaowu',
    base: {
      name: '塘散',
      type: '灵修' as CultivationType,
      hp: 8, atk: 7, mnd: 3, hpCap: 8,
      skills: ['hero_tangsan.battle.cage', 'hero_tangsan.ultimate'],
      portrait: 'hero_tangsan',
    },
    awakened: {
      name: '修罗·塘散',
      type: '灵修' as CultivationType,
      hp: 10, atk: 10, mnd: 3, hpCap: 10,
      skills: ['hero_tangsan.awaken.battle', 'hero_tangsan.awaken.ultimate'],
      portrait: 'hero_tangsan_awaken',
    },
  },
  hero_xiaowu: {
    heroId: 'hero_xiaowu',
    name: '小舞儿',
    ipTag: 'douluo',
    awakenTrigger: 'self_hp_to_1',
    base: {
      name: '小舞儿',
      type: '妖修' as CultivationType,
      hp: 7, atk: 6, mnd: 4, hpCap: 7,
      skills: ['hero_xiaowu.battle', 'hero_xiaowu.ultimate'],
      portrait: 'hero_xiaowu',
    },
    awakened: {
      name: '献祭·小舞儿',
      type: '妖修' as CultivationType,
      hp: 1, atk: 1, mnd: 1, hpCap: 1,
      skills: ['hero_xiaowu.awaken.battle', 'hero_xiaowu.awaken.ultimate'],
      portrait: 'hero_xiaowu_awaken',
    },
  },
  hero_xiaoyan: {
    heroId: 'hero_xiaoyan',
    name: '萧焱',
    ipTag: 'doupo',
    awakenTrigger: 'doupo_count_ge_3',
    base: {
      name: '萧焱',
      type: '法修' as CultivationType,
      hp: 7, atk: 8, mnd: 3, hpCap: 7,
      skills: ['hero_xiaoyan.battle', 'hero_xiaoyan.ultimate'],
      portrait: 'hero_xiaoyan',
    },
    awakened: {
      name: '炎帝·萧焱',
      type: '法修' as CultivationType,
      hp: 9, atk: 10, mnd: 3, hpCap: 9,
      skills: ['hero_xiaoyan.awaken.battle', 'hero_xiaoyan.awaken.ultimate'],
      portrait: 'hero_xiaoyan_awaken',
    },
  },
  hero_xuner: {
    heroId: 'hero_xuner',
    name: '薰儿',
    ipTag: 'doupo',
    awakenTrigger: 'xuner_guyuan_hp_le_3',
    base: {
      name: '薰儿',
      type: '灵修' as CultivationType,
      hp: 6, atk: 5, mnd: 5, hpCap: 6,
      skills: ['hero_xuner.battle', 'hero_xuner.ultimate'],
      portrait: 'hero_xuner',
    },
    awakened: {
      name: '斗帝血脉·薰儿',
      type: '灵修' as CultivationType,
      hp: 8, atk: 7, mnd: 5, hpCap: 8,
      skills: ['hero_xuner.awaken.battle', 'hero_xuner.awaken.ultimate'],
      portrait: 'hero_xuner_awaken',
    },
  },
  hero_hanli: {
    heroId: 'hero_hanli',
    name: '寒立',
    ipTag: 'xianni', // 凡人修仙传
    awakenTrigger: 'self_kill_count_ge_2',
    base: {
      name: '寒立',
      type: '剑修' as CultivationType,
      hp: 7, atk: 7, mnd: 4, hpCap: 7,
      skills: ['hero_hanli.battle', 'hero_hanli.ultimate'],
      portrait: 'hero_hanli',
    },
    awakened: {
      name: '元婴·寒立',
      type: '剑修' as CultivationType,
      hp: 9, atk: 9, mnd: 4, hpCap: 9,
      skills: ['hero_hanli.awaken.battle', 'hero_hanli.awaken.ultimate'],
      portrait: 'hero_hanli_awaken',
    },
  },
  hero_wanglin: {
    heroId: 'hero_wanglin',
    name: '旺林',
    ipTag: 'xianni',
    awakenTrigger: 'ally_situnan_leave',
    relatedHeroId: 'bind_situnan', // 阶段 D 补真实 id
    base: {
      name: '旺林',
      type: '法修' as CultivationType,
      hp: 7, atk: 8, mnd: 3, hpCap: 7,
      skills: ['hero_wanglin.battle', 'hero_wanglin.ultimate'],
      portrait: 'hero_wanglin',
    },
    awakened: {
      name: '仙尊·旺林',
      type: '法修' as CultivationType,
      hp: 10, atk: 10, mnd: 4, hpCap: 10,
      skills: ['hero_wanglin.awaken.battle', 'hero_wanglin.awaken.ultimate'],
      portrait: 'hero_wanglin_awaken',
    },
  },
};

/** 根据主角 id 获取蓝图 */
export function getHeroBlueprint(heroId: string): HeroBlueprint | undefined {
  return HERO_BLUEPRINTS[heroId];
}

/** 用于萧焱觉醒触发：数场上斗破角色 */
export function countDoupoUnits(unitIpTags: Array<HeroIpTag | undefined>): number {
  return unitIpTags.filter((t) => t === 'doupo').length;
}
