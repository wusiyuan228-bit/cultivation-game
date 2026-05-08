/**
 * 【戴沐白 / 白虎裂光波】通用SR · SR绝技
 * 原文：戴沐白退场时（主动/被动），对四个方向相邻的所有角色造成4点固定伤害
 * trigger: on_self_leave  effect: aoe_damage_on_death（自动触发，不占主动发动位，Q54）
 */
import type { SkillRegistration, HookHandler } from '../types';

export const skill_daimubai_liguangbo: SkillRegistration = {
  id: 'sr_daimubai.ultimate',
  name: '白虎裂光波',
  description: '退场时对四向相邻所有角色造成 4 点固定伤害（自动触发）',
  hooks: {
    on_self_leave: ((ctx, engine) => {
      const self = engine.getUnit(ctx.attacker.id) ?? engine.getUnit(ctx.defender.id);
      if (!self) return;
      const around = engine
        .getAllUnits()
        .filter((u) => u.isAlive && Math.abs(u.row - self.row) + Math.abs(u.col - self.col) === 1);
      if (around.length === 0) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'sr_daimubai.ultimate' },
          `白虎裂光波发动但四向无相邻角色`,
          { actorId: self.id, skillId: 'sr_daimubai.ultimate', severity: 'info' },
        );
        return;
      }
      engine.emit(
        'skill_active_cast',
        { skillId: 'sr_daimubai.ultimate', auto: true, targets: around.map((u) => u.id) },
        `白虎裂光波触发，对 ${around.length} 名相邻角色各造成 4 点固伤`,
        { actorId: self.id, targetIds: around.map((u) => u.id), skillId: 'sr_daimubai.ultimate', severity: 'climax' },
      );
      around.forEach((u) => {
        engine.changeStat(u.id, 'hp', -4, {
          permanent: false,
          reason: '白虎裂光波',
          skillId: 'sr_daimubai.ultimate',
        });
      });
    }) as HookHandler,
  },
};
