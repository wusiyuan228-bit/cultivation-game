/**
 * 【傲思卡 / 大香肠】通用SR · 战斗技能
 * 原文：行动轮结束时，可指定1名友军气血+2（不可超上限）
 * MVP：自动给 hp 损失最多的友军 +2
 */
import type { SkillRegistration, TurnHookHandler } from '../types';

export const skill_aoska_xiangchang: SkillRegistration = {
  id: 'sr_aoska.battle',
  name: '大香肠',
  description: '行动轮结束时，可选 1 名友军 hp+2（不可超上限）',
  hooks: {
    on_turn_end: ((ctx, engine) => {
      const self = ctx.unit;
      if (!self.isAlive || !self.skills.includes('sr_aoska.battle')) return;
      const allies = engine.getAlliesOf(self).filter((u) => u.isAlive && u.hp.current < u.hpCap);
      if (allies.length === 0) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'sr_aoska.battle' },
          `大香肠待命——全员满血`,
          { actorId: self.id, skillId: 'sr_aoska.battle', severity: 'info' },
        );
        return;
      }
      // 最缺血的
      const target = allies.sort((a, b) => a.hp.current / a.hpCap - b.hp.current / b.hpCap)[0];
      engine.emit(
        'skill_passive_trigger',
        { skillId: 'sr_aoska.battle' },
        `大香肠：为 ${target.name} 回复 2 点气血（自动选择 · 最缺血的友军）`,
        { actorId: self.id, targetIds: [target.id], skillId: 'sr_aoska.battle', severity: 'highlight' },
      );
      engine.changeStat(target.id, 'hp', 2, {
        permanent: false,
        breakCap: false,
        reason: '大香肠',
        skillId: 'sr_aoska.battle',
      });
    }) as TurnHookHandler,
  },
};
