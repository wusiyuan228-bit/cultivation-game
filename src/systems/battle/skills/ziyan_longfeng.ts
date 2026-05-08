/**
 * 【紫妍 / 龙凤变】通用SR · SR绝技
 * 原文：紫妍退场时（主动/被动），对所在行与列的所有角色造成2点固定伤害
 * Q54 自动触发
 */
import type { SkillRegistration, HookHandler } from '../types';

export const skill_ziyan_longfeng: SkillRegistration = {
  id: 'sr_ziyan.ultimate',
  name: '龙凤变',
  description: '退场时对所在行/列所有角色造成 2 点固伤（自动触发）',
  hooks: {
    on_self_leave: ((ctx, engine) => {
      const self = engine.getUnit(ctx.attacker.id) ?? engine.getUnit(ctx.defender.id);
      if (!self) return;
      const line = engine
        .getAllUnits()
        .filter((u) => u.isAlive && u.id !== self.id && (u.row === self.row || u.col === self.col));
      if (line.length === 0) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'sr_ziyan.ultimate' },
          `龙凤变发动但所在行列无其他角色`,
          { actorId: self.id, skillId: 'sr_ziyan.ultimate', severity: 'info' },
        );
        return;
      }
      engine.emit(
        'skill_active_cast',
        { skillId: 'sr_ziyan.ultimate', auto: true, targets: line.map((u) => u.id) },
        `龙凤变触发：${line.length} 名行列角色各承受 2 点固伤`,
        { actorId: self.id, targetIds: line.map((u) => u.id), skillId: 'sr_ziyan.ultimate', severity: 'climax' },
      );
      line.forEach((u) => {
        engine.changeStat(u.id, 'hp', -2, {
          permanent: false,
          reason: '龙凤变',
          skillId: 'sr_ziyan.ultimate',
        });
      });
    }) as HookHandler,
  },
};
