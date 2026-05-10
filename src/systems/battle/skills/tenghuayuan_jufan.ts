/**
 * 【腾华原 / 黑泥潭·聚魂幡】通用SR · SR绝技
 * 原文：腾华原退场时（主动/被动），可操纵最多 3 个角色各移动一次（按其 mnd 距离）
 * MVP：仅 emit 意图，真实移动由 store 层处理
 */
import type { SkillRegistration, HookHandler } from '../types';

export const skill_tenghuayuan_jufan: SkillRegistration = {
  id: 'sr_tenghuayuan.ultimate',
  name: '黑泥潭·聚魂幡',
  description: '退场时操纵最多 3 名角色各移动一次（按其 mnd 距离）',
  hooks: {
    on_self_leave: ((ctx, engine) => {
      const self = engine.getUnit(ctx.attacker.id) ?? engine.getUnit(ctx.defender.id);
      if (!self) return;
      const candidates = engine
        .getAllUnits()
        .filter((u) => u.isAlive && u.id !== self.id && u.mnd.current > 0)
        .slice(0, 3);
      if (candidates.length === 0) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'sr_tenghuayuan.ultimate' },
          `黑泥潭·聚魂幡未生效——无可操纵角色`,
          { actorId: self.id, skillId: 'sr_tenghuayuan.ultimate', severity: 'info' },
        );
        return;
      }
      engine.emit(
        'skill_active_cast',
        { skillId: 'sr_tenghuayuan.ultimate', targets: candidates.map((u) => u.id) },
        `黑泥潭·聚魂幡：操纵 ${candidates.length} 名角色按其 mnd 距离移动`,
        { actorId: self.id, targetIds: candidates.map((u) => u.id), skillId: 'sr_tenghuayuan.ultimate', severity: 'climax' },
      );
    }) as HookHandler,
  },
};
