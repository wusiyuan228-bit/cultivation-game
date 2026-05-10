/**
 * 【徐立国 / 剑魂·威慑】通用SR · 战斗技能
 * 原文：被攻击时，若 attacker.atk > self.atk，则本次伤害减半（向下取整）
 * Q70：取 modifier 后的当前值
 */
import type { SkillRegistration, HookHandler } from '../types';

export const skill_xuliguo_weishe: SkillRegistration = {
  id: 'sr_xuliguo.battle',
  name: '剑魂·威慑',
  description: '被攻击时若 attacker.atk > self.atk，本次伤害减半（floor）',
  hooks: {
    on_damage_calc: ((ctx, engine) => {
      const self = engine.getUnit(ctx.defender.id);
      const attacker = engine.getUnit(ctx.attacker.id);
      if (!self || !attacker || !self.skills.includes('sr_xuliguo.battle')) return;
      if (attacker.atk.current <= self.atk.current) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'sr_xuliguo.battle' },
          `剑魂·威慑未触发——攻方修为 ≤ 自身`,
          { actorId: self.id, skillId: 'sr_xuliguo.battle', severity: 'info' },
        );
        return;
      }
      const preview = ctx.calcLog.reduce((s, x) => s + x.delta, ctx.aSum - ctx.dSum);
      if (preview <= 0) return;
      const halved = Math.floor(preview / 2);
      ctx.calcLog.push({ source: '剑魂·威慑', delta: halved - preview, note: `减半 floor` });
      engine.emit(
        'skill_passive_trigger',
        { skillId: 'sr_xuliguo.battle', fromDmg: preview, toDmg: halved },
        `剑魂·威慑：伤害 ${preview} 减半 floor 为 ${halved}`,
        { actorId: self.id, targetIds: [attacker.id], skillId: 'sr_xuliguo.battle', severity: 'highlight' },
      );
    }) as HookHandler,
  },
};
