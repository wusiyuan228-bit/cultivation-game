/**
 * 【雲蕴 / 风刃·凌空】通用SSR · 战斗技能（被动·扩展攻击距离）
 * 策划原文：可攻击2格距离内的敌人（突破相邻限制）
 * Q44：曼哈顿距离 ≤2
 *
 * 实装说明：
 *   引擎不直接实施 "扩展攻击范围"（由 s7bBattleStore 的 attackRange 计算消费此 autoModifier）。
 *   此处挂载一个 aura_range_extend modifier 给自身，store 层在计算 attackRange 时读取它。
 */
import type { SkillRegistration, Modifier, BattleUnit } from '../types';
import { PRIORITY } from '../types';

export const skill_yunyun_fengren: SkillRegistration = {
  id: 'ssr_yunyun.battle',
  name: '风刃·凌空',
  description: '可攻击2格距离内的敌人（突破相邻限制）',
  autoModifiers: (self: BattleUnit): Modifier[] => [
    {
      id: `yunyun_range_${self.id}`,
      sourceSkillId: 'ssr_yunyun.battle',
      sourceUnitId: self.id,
      category: 'permanent',
      targetUnitId: self.id,
      kind: 'aura_range_extend',
      payload: { range: 2 },
      duration: { type: 'permanent_in_battle' },
      priority: PRIORITY.CONSTANT,
    },
  ],
  hooks: {},
};
