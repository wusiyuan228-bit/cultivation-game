/**
 * 【岱牧百 / 白虎金身】通用SR · 战斗技能
 * 原文：受到伤害时，伤害上限为2点（无论攻击伤害还是技能直接伤害）
 * trigger: on_damage_calc  effect: damage_cap  value=2
 */
import type { SkillRegistration, HookHandler } from '../types';

export const skill_daimubai_jinshen: SkillRegistration = {
  id: 'sr_daimubai.battle',
  name: '白虎金身',
  description: '受到伤害时伤害上限为 2（含技能伤害）',
  hooks: {
    on_damage_calc: ((ctx, engine) => {
      if (ctx.defender.id !== engine.getUnit(ctx.defender.id)?.id) return;
      // 仅作为被防守方生效
      const self = engine.getUnit(ctx.defender.id);
      if (!self || !self.skills.includes('sr_daimubai.battle')) return;

      // 计算 calcLog 当前伤害趋势
      const preview = ctx.calcLog.reduce((s, x) => s + x.delta, ctx.aSum - ctx.dSum);
      if (preview <= 2) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'sr_daimubai.battle' },
          `白虎金身待命——本次伤害 ${preview} ≤ 2，无需封顶`,
          { actorId: self.id, skillId: 'sr_daimubai.battle', severity: 'info' },
        );
        return;
      }
      const cap = 2 - preview; // 负值，用来拉到 2
      ctx.calcLog.push({ source: '白虎金身', delta: cap, note: `封顶为 2` });
      engine.emit(
        'skill_passive_trigger',
        { skillId: 'sr_daimubai.battle', fromDmg: preview, toDmg: 2 },
        `白虎金身：伤害 ${preview} 封顶为 2`,
        { actorId: self.id, skillId: 'sr_daimubai.battle', severity: 'highlight' },
      );
    }) as HookHandler,
  },
};
