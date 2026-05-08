/**
 * 【萧战 / 萧家八极·守】绑定SR · 战斗技能
 *
 * 策划原文：只要本行动轮你未对外进行攻击，敌方对你造成的伤害-5（最低为0）
 *
 * 契约登记：
 *   trigger  : on_damage_calc（被攻击方）
 *   effect   : conditional_damage_reduce（-5，min=0）
 *   裁决 Q36 ："未对外攻击" = 基础+绝技均未发动（含反伤/溅射/自伤的判定参见 Q36 最终定义）
 */
import type { SkillRegistration, HookHandler } from '../types';

export const skill_xiaozhan_bajishou: SkillRegistration = {
  id: 'bsr_xiaozhan.battle',
  name: '萧家八极·守',
  description: '只要本行动轮你未对外进行攻击，敌方对你造成的伤害-5（最低为0）',
  hooks: {
    on_damage_calc: ((ctx, engine) => {
      const self = engine.getUnit(ctx.defender.id);
      if (!self || self.id !== ctx.defender.id) return;
      // Q36：未进攻 = 本轮 didBasicAttack=false && didUltimateAttack=false
      if (self.perTurn.didBasicAttack || self.perTurn.didUltimateAttack) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'bsr_xiaozhan.battle', reason: 'already_attacked' },
          `「萧家八极·守」未触发——本轮已发起过攻击`,
          { actorId: self.id, skillId: 'bsr_xiaozhan.battle', severity: 'info' },
        );
        return;
      }
      engine.emit(
        'skill_passive_trigger',
        { skillId: 'bsr_xiaozhan.battle' },
        `「萧家八极·守」触发，伤害 -5（最低 0）`,
        { actorId: self.id, skillId: 'bsr_xiaozhan.battle', severity: 'info' },
      );
      ctx.calcLog.push({
        source: 'bsr_xiaozhan.battle',
        delta: -5,
        note: '萧家八极·守 -5，最低0',
      });
    }) as HookHandler,
  },
};
