/**
 * 【子妍 / 龙族暴怒】通用SR · 战斗技能
 * 原文：攻击妖修类敌人时，修为+2（不可超上限）
 * Q59：按"骰数+2"实装
 */
import type { SkillRegistration, HookHandler } from '../types';

export const skill_ziyan_baonu: SkillRegistration = {
  id: 'sr_ziyan.battle',
  name: '龙族暴怒',
  description: '攻击妖修类敌人时骰数 +2',
  hooks: {
    on_before_roll: ((ctx, engine) => {
      const self = engine.getUnit(ctx.attacker.id);
      const target = engine.getUnit(ctx.defender.id);
      if (!self || !target || !self.skills.includes('sr_ziyan.battle')) return;
      if (target.type !== '妖修') {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'sr_ziyan.battle' },
          `龙族暴怒未触发——目标非妖修`,
          { actorId: self.id, skillId: 'sr_ziyan.battle', severity: 'info' },
        );
        return;
      }
      ctx.diceAttack += 2;
      engine.emit(
        'skill_passive_trigger',
        { skillId: 'sr_ziyan.battle', extraDice: 2 },
        `龙族暴怒：骰数 +2（对妖修）`,
        { actorId: self.id, targetIds: [target.id], skillId: 'sr_ziyan.battle', severity: 'highlight' },
      );
    }) as HookHandler,
  },
};
