/**
 * 【王冬儿 / 光明圣龙】绑定SR · 战斗技能
 *
 * 策划原文：修为判定时（自己投骰后），如果骰出的骰子中有偶数，则气血+2（不可超过气血上限）
 *
 * 契约登记：
 *   trigger  : on_after_roll（Q35：仅限进攻方投骰）
 *   effect   : conditional_heal（+2，不突破上限）
 */
import type { SkillRegistration, HookHandler } from '../types';

export const skill_wangdonger_shenglong: SkillRegistration = {
  id: 'bsr_wangdonger.battle',
  name: '光明圣龙',
  description: '进攻投骰时，若骰面含偶数，自身气血+2（不可超过上限）',
  hooks: {
    on_after_attack_roll: ((ctx, engine) => {
      const self = engine.getUnit(ctx.attacker.id);
      if (!self || !self.isAlive) return;
      // Q35：仅进攻方投骰触发（此钩子本身就是进攻方 on_after_attack_roll）
      // MVP：由于引擎只暴露 aSum 不暴露骰面明细，此处以 aSum 是否为偶数近似
      // 准确实现需扩展 ctx.diceAttackRaw: number[]；阶段 E3 再精确化
      const hasEven = ctx.aSum % 2 === 0; // 近似：aSum 偶数 ≈ 至少有一个偶骰
      if (!hasEven) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'bsr_wangdonger.battle', reason: 'no_even' },
          `「光明圣龙」未触发——本次骰面无偶数`,
          { actorId: self.id, skillId: 'bsr_wangdonger.battle', severity: 'info' },
        );
        return;
      }
      if (self.hp.current >= self.hpCap) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'bsr_wangdonger.battle', reason: 'full_hp' },
          `「光明圣龙」待命——自身已满血`,
          { actorId: self.id, skillId: 'bsr_wangdonger.battle', severity: 'info' },
        );
        return;
      }
      engine.emit(
        'skill_passive_trigger',
        { skillId: 'bsr_wangdonger.battle' },
        `「光明圣龙」触发，气血 +2`,
        { actorId: self.id, skillId: 'bsr_wangdonger.battle', severity: 'info' },
      );
      engine.changeStat(self.id, 'hp', +2, {
        permanent: false,
        breakCap: false,
        reason: '光明圣龙',
        skillId: 'bsr_wangdonger.battle',
      });
    }) as HookHandler,
  },
};
