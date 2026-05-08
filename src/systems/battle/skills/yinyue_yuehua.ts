/**
 * 【银月 / 月华护体】绑定SR · 战斗技能
 *
 * 策划原文：被攻击时，可消耗自身2点气血，抵挡本次全部伤害
 *
 * 契约登记：
 *   trigger  : on_damage_calc（被攻击方）
 *   effect   : immune_at_cost
 *   裁决 Q39 ：hp ≥ 3 才可发动（消耗后 ≥1）
 *   裁决 Q31 ：人类弹窗；AI MVP 自动发动（仅在 cost 内且本次受击伤害 ≥3 时发动）
 */
import type { SkillRegistration, HookHandler } from '../types';

export const skill_yinyue_yuehua: SkillRegistration = {
  id: 'bsr_yinyue.battle',
  name: '月华护体',
  description: '被攻击时，可消耗自身2点气血，抵挡本次全部伤害',
  hooks: {
    on_damage_calc: ((ctx, engine) => {
      const self = engine.getUnit(ctx.defender.id);
      if (!self || self.id !== ctx.defender.id) return;
      // Q39：hp ≥ 3 才可发动
      if (self.hp.current < 3) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'bsr_yinyue.battle', reason: 'hp_too_low' },
          `「月华护体」无法启动——气血不足（消耗2点后自身无法存活）`,
          { actorId: self.id, skillId: 'bsr_yinyue.battle', severity: 'info' },
        );
        return;
      }
      // 估算本次最终伤害
      const baseDmg = ctx.aSum - ctx.dSum;
      if (baseDmg < 3) {
        // MVP：伤害<3 时不划算，不发动
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'bsr_yinyue.battle', reason: 'damage_too_low' },
          `「月华护体」待命——本次伤害较低（${baseDmg}）不值得消耗`,
          { actorId: self.id, skillId: 'bsr_yinyue.battle', severity: 'info' },
        );
        return;
      }
      // 发动：消耗 hp -2，本次伤害清零（通过 calcLog 加大减项）
      engine.changeStat(self.id, 'hp', -2, {
        permanent: false,
        reason: '月华护体消耗',
        skillId: 'bsr_yinyue.battle',
      });
      engine.emit(
        'skill_passive_trigger',
        { skillId: 'bsr_yinyue.battle' },
        `「月华护体」触发，本次伤害被完全抵挡（自动发动 · 受伤≥3 且 hp≥3）`,
        { actorId: self.id, skillId: 'bsr_yinyue.battle', severity: 'highlight' },
      );
      ctx.calcLog.push({
        source: 'bsr_yinyue.battle',
        delta: -9999,
        note: '月华护体：伤害全免',
      });
    }) as HookHandler,
  },
};
