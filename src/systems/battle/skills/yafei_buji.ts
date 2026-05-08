/**
 * 【雅妃 / 迦南商会·补给】通用SR · 战斗技能
 * 原文：行动轮开始时，可指定 1 名友军和自己各 +1 气血（不可超上限）
 */
import type { SkillRegistration, TurnHookHandler } from '../types';

export const skill_yafei_buji: SkillRegistration = {
  id: 'sr_yafei.battle',
  name: '迦南商会·补给',
  description: '行动轮开始时，自身 +1 hp 并为 1 名友军 +1 hp',
  hooks: {
    on_turn_start: ((ctx, engine) => {
      const self = ctx.unit;
      if (!self.isAlive || !self.skills.includes('sr_yafei.battle')) return;
      const otherAllies = engine.getAlliesOf(self).filter((u) => u.isAlive && u.id !== self.id);
      const missingSelf = self.hp.current < self.hpCap;
      const target = otherAllies
        .filter((u) => u.hp.current < u.hpCap)
        .sort((a, b) => a.hp.current / a.hpCap - b.hp.current / b.hpCap)[0];

      if (!missingSelf && !target) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'sr_yafei.battle' },
          `迦南商会·补给待命——自身及可选友军均已满血`,
          { actorId: self.id, skillId: 'sr_yafei.battle', severity: 'info' },
        );
        return;
      }
      engine.emit(
        'skill_passive_trigger',
        { skillId: 'sr_yafei.battle' },
        `迦南商会·补给 触发`,
        { actorId: self.id, skillId: 'sr_yafei.battle', severity: 'highlight' },
      );
      if (missingSelf) {
        engine.changeStat(self.id, 'hp', 1, {
          permanent: false,
          breakCap: false,
          reason: '迦南商会·补给',
          skillId: 'sr_yafei.battle',
        });
      }
      if (target) {
        engine.changeStat(target.id, 'hp', 1, {
          permanent: false,
          breakCap: false,
          reason: '迦南商会·补给',
          skillId: 'sr_yafei.battle',
        });
      }
    }) as TurnHookHandler,
  },
};
