/**
 * 【红蝶 / 蝶舞红尘】通用SR · 战斗技能
 * 原文：红蝶退场时（主动/被动），可指定任一角色 1 个未使用的绝技作废
 */
import type { SkillRegistration, HookHandler, Modifier } from '../types';
import { PRIORITY } from '../types';

export const skill_hongdie_diewu: SkillRegistration = {
  id: 'sr_hongdie.battle',
  name: '蝶舞红尘',
  description: '退场时作废 1 名角色未使用的绝技',
  hooks: {
    on_self_leave: ((ctx, engine) => {
      const self = engine.getUnit(ctx.attacker.id) ?? engine.getUnit(ctx.defender.id);
      if (!self) return;
      // MVP：挑选第一个 ultimateUsed=false 且非本人的角色
      const target = engine
        .getAllUnits()
        .find((u) => u.isAlive && u.id !== self.id && !u.ultimateUsed);
      if (!target) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'sr_hongdie.battle' },
          `蝶舞红尘发动——无未使用绝技的目标`,
          { actorId: self.id, skillId: 'sr_hongdie.battle', severity: 'info' },
        );
        return;
      }
      const mod: Modifier = {
        id: `dwht_${target.id}_${engine.nextSeq()}`,
        sourceSkillId: 'sr_hongdie.battle',
        sourceUnitId: self.id,
        category: 'permanent',
        targetUnitId: target.id,
        kind: 'ultimate_invalidated',
        payload: {},
        duration: { type: 'permanent_in_battle' },
        priority: PRIORITY.CONSTANT,
      };
      engine.attachModifier(mod);
      engine.emit(
        'skill_passive_trigger',
        { skillId: 'sr_hongdie.battle' },
        `蝶舞红尘：作废 ${target.name} 的绝技（本场不可再使用）（自动选择 · 首个绝技未用的敌方）`,
        { actorId: self.id, targetIds: [target.id], skillId: 'sr_hongdie.battle', severity: 'climax' },
      );
    }) as HookHandler,
  },
};
