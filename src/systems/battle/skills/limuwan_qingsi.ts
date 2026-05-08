/**
 * 【李慕婉 / 情丝牵引】绑定SR · 战斗技能
 *
 * 策划原文：行动轮开始时，若旺林在场则治疗旺林2点气血；否则治疗自身1点（不可超上限）
 *
 * 契约登记：
 *   trigger  : on_turn_start
 *   裁决 Q40 ：主对象满血不 fallback 治自身（只披露未生效）
 */
import type { SkillRegistration, TurnHookHandler } from '../types';

export const skill_limuwan_qingsi: SkillRegistration = {
  id: 'bsr_limuwan.battle',
  name: '情丝牵引',
  description: '行动轮开始时，若旺林在场则治疗旺林2点；否则治疗自身1点',
  hooks: {
    on_turn_start: ((tctx, engine) => {
      const self = engine.getUnit(tctx.unit.id);
      if (!self || !self.isAlive) return;

      const wanglin = engine
        .getAllUnits()
        .find(
          (u) =>
            u.isAlive &&
            u.owner === self.owner &&
            (u.id.includes('wanglin') || u.name.includes('旺林')),
        );

      if (wanglin) {
        // Q40：旺林满血 → 不 fallback，只披露
        if (wanglin.hp.current >= wanglin.hpCap) {
          engine.emit(
            'skill_effect_blocked',
            { skillId: 'bsr_limuwan.battle', reason: 'wanglin_full' },
            `「情丝牵引」对旺林无效——已满血`,
            { actorId: self.id, targetIds: [wanglin.id], skillId: 'bsr_limuwan.battle', severity: 'info' },
          );
          return;
        }
        engine.emit(
          'skill_passive_trigger',
          { skillId: 'bsr_limuwan.battle' },
          `「情丝牵引」触发，旺林 +2 气血`,
          { actorId: self.id, targetIds: [wanglin.id], skillId: 'bsr_limuwan.battle', severity: 'info' },
        );
        engine.changeStat(wanglin.id, 'hp', +2, {
          permanent: false,
          reason: '情丝牵引',
          skillId: 'bsr_limuwan.battle',
        });
      } else {
        // fallback 治自身
        if (self.hp.current >= self.hpCap) {
          engine.emit(
            'skill_effect_blocked',
            { skillId: 'bsr_limuwan.battle', reason: 'self_full' },
            `「情丝牵引」未生效——自身已满血`,
            { actorId: self.id, skillId: 'bsr_limuwan.battle', severity: 'info' },
          );
          return;
        }
        engine.emit(
          'skill_passive_trigger',
          { skillId: 'bsr_limuwan.battle' },
          `「情丝牵引」触发，自身 +1 气血`,
          { actorId: self.id, skillId: 'bsr_limuwan.battle', severity: 'info' },
        );
        engine.changeStat(self.id, 'hp', +1, {
          permanent: false,
          reason: '情丝牵引',
          skillId: 'bsr_limuwan.battle',
        });
      }
    }) as TurnHookHandler,
  },
};
