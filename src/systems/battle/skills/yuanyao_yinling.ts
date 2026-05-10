/**
 * 【缘瑶 / 阴灵之力】通用SR · 战斗技能
 * 原文：进攻后，目标心境永久 -1（最低 0）
 */
import type { SkillRegistration, HookHandler } from '../types';

export const skill_yuanyao_yinling: SkillRegistration = {
  id: 'sr_yuanyao.battle',
  name: '阴灵之力',
  description: '进攻后目标 mnd 永久 -1（最低 0）',
  hooks: {
    on_after_hit: ((ctx, engine) => {
      const self = engine.getUnit(ctx.attacker.id);
      const target = engine.getUnit(ctx.defender.id);
      if (!self || !target || !self.skills.includes('sr_yuanyao.battle')) return;
      if (ctx.attackKind !== 'basic') return;
      if (target.mnd.current <= 0) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'sr_yuanyao.battle' },
          `${target.name} 心境已为 0，阴灵之力未生效`,
          { actorId: self.id, targetIds: [target.id], skillId: 'sr_yuanyao.battle', severity: 'info' },
        );
        return;
      }
      engine.emit(
        'skill_passive_trigger',
        { skillId: 'sr_yuanyao.battle' },
        `阴灵之力：${target.name} 心境 -1`,
        { actorId: self.id, targetIds: [target.id], skillId: 'sr_yuanyao.battle', severity: 'highlight' },
      );
      engine.changeStat(target.id, 'mnd', -1, {
        permanent: true,
        floor: 0,
        reason: '阴灵之力',
        skillId: 'sr_yuanyao.battle',
      });
    }) as HookHandler,
  },
};
