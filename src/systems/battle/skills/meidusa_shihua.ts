/**
 * 【美杜莎 / 蛇后之瞳·石化】通用SSR · 绝技
 * 策划原文：美杜莎退场时（主动/被动），可让1名指定角色永远无法移动
 */
import type { Modifier, SkillRegistration, HookHandler } from '../types';
import { PRIORITY } from '../types';

export const skill_meidusa_shihua: SkillRegistration = {
  id: 'ssr_meidusa.ult',
  name: '蛇后之瞳·石化',
  description: '美杜莎退场时，可让1名指定角色永远无法移动',
  hooks: {
    on_self_leave: ((ctx, engine) => {
      const self = engine.getUnit(ctx.defender.id);
      if (!self) return;
      const candidates = engine
        .getAllUnits()
        .filter((u) => u.isAlive && u.id !== self.id);
      if (candidates.length === 0) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'ssr_meidusa.ult', reason: 'no_target' },
          `「蛇后之瞳·石化」未生效——场上已无可选目标`,
          { actorId: self.id, skillId: 'ssr_meidusa.ult', severity: 'info' },
        );
        return;
      }
      // MVP：选敌方 atk 最高者
      const enemies = candidates.filter((u) => u.owner !== self.owner);
      const target =
        enemies.length > 0
          ? enemies.sort((a, b) => b.atk.current - a.atk.current)[0]
          : candidates[0];
      const mod: Modifier = {
        id: `shihua_${target.id}`,
        sourceSkillId: 'ssr_meidusa.ult',
        sourceUnitId: self.id,
        category: 'permanent',
        targetUnitId: target.id,
        kind: 'disable_move',
        payload: {},
        duration: { type: 'permanent' },
        priority: PRIORITY.TEMPORAL,
      };
      engine.attachModifier(mod);
      engine.emit(
        'skill_passive_trigger',
        { skillId: 'ssr_meidusa.ult' },
        `「蛇后之瞳·石化」触发，${target.name} 被永久石化（自动选择 · atk最高的敌人）`,
        { actorId: self.id, targetIds: [target.id], skillId: 'ssr_meidusa.ult', severity: 'climax' },
      );
    }) as HookHandler,
  },
};
