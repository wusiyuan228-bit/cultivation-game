/**
 * 【风娴 / 风卷残云】通用SR · 战斗技能
 * 原文：本行动轮若未造成任何伤害，则下一个行动轮心境+2
 * Q58：读 perTurn.didCauseAnyDamage（Q36/Q58 统一定义，含自伤/反伤/溅射）
 */
import type { SkillRegistration, TurnHookHandler, Modifier } from '../types';
import { PRIORITY } from '../types';

export const skill_fengxian_canyun: SkillRegistration = {
  id: 'sr_fengxian.battle',
  name: '风卷残云',
  description: '本轮未造成任何伤害时，下一轮 mnd+2',
  hooks: {
    on_turn_end: ((ctx, engine) => {
      const self = ctx.unit;
      if (!self.isAlive || !self.skills.includes('sr_fengxian.battle')) return;
      if (self.perTurn.didCauseAnyDamage) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'sr_fengxian.battle' },
          `风卷残云未触发——本行动轮已造成伤害`,
          { actorId: self.id, skillId: 'sr_fengxian.battle', severity: 'info' },
        );
        return;
      }
      if (self.mnd.current >= 9) {
        engine.emit(
          'skill_passive_trigger',
          { skillId: 'sr_fengxian.battle' },
          `风卷残云触发但 mnd 已达上限`,
          { actorId: self.id, skillId: 'sr_fengxian.battle', severity: 'info' },
        );
        return;
      }
      const mod: Modifier = {
        id: `fjcy_${self.id}_${engine.nextSeq()}`,
        sourceSkillId: 'sr_fengxian.battle',
        sourceUnitId: self.id,
        category: 'temporal',
        targetUnitId: self.id,
        kind: 'stat_delta',
        payload: { stat: 'mnd', delta: 2, clampTo: 9 },
        duration: { type: 'next_turn', turnOwnerId: self.id },
        priority: PRIORITY.TEMPORAL,
      };
      engine.attachModifier(mod);
      engine.emit(
        'skill_passive_trigger',
        { skillId: 'sr_fengxian.battle' },
        `风卷残云：下一行动轮 mnd+2`,
        { actorId: self.id, skillId: 'sr_fengxian.battle', severity: 'highlight' },
      );
    }) as TurnHookHandler,
  },
};
