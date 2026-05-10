/**
 * 【子绫 / 韩老魔·治愈】通用SSR · 战斗技能
 * 策划原文：进攻后，自身与寒立各气血+1（寒立不在场则仅自身+1，可突破上限）
 * Q15：需造成伤害才触发（按契约 on_after_hit）
 */
import type { SkillRegistration, HookHandler } from '../types';

export const skill_ziling_laomo: SkillRegistration = {
  id: 'ssr_ziling.battle',
  name: '韩老魔·治愈',
  description: '进攻后，自身与寒立各气血+1（寒立不在场仅自身+1，可突破上限）',
  hooks: {
    on_after_hit: ((ctx, engine) => {
      const self = engine.getUnit(ctx.attacker.id);
      if (!self) return;
      engine.changeStat(self.id, 'hp', +1, {
        permanent: false,
        breakCap: true,
        reason: '韩老魔·治愈',
        skillId: 'ssr_ziling.battle',
      });
      const hanli = engine
        .getAllUnits()
        .find(
          (u) =>
            u.isAlive &&
            u.owner === self.owner &&
            (u.id.includes('hanli') || u.name.includes('寒立')),
        );
      if (hanli && hanli.id !== self.id) {
        engine.changeStat(hanli.id, 'hp', +1, {
          permanent: false,
          breakCap: true,
          reason: '韩老魔·治愈',
          skillId: 'ssr_ziling.battle',
        });
        engine.emit(
          'skill_passive_trigger',
          { skillId: 'ssr_ziling.battle' },
          `「韩老魔·治愈」触发，子绫与寒立各 +1 气血`,
          { actorId: self.id, targetIds: [hanli.id], skillId: 'ssr_ziling.battle', severity: 'info' },
        );
      } else {
        engine.emit(
          'skill_passive_trigger',
          { skillId: 'ssr_ziling.battle', hanliAbsent: true },
          `「韩老魔·治愈」仅治愈自身——寒立不在场`,
          { actorId: self.id, skillId: 'ssr_ziling.battle', severity: 'info' },
        );
      }
    }) as HookHandler,
  },
};
