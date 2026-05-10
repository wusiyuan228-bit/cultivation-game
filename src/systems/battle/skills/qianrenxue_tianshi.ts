/**
 * 【千刃雪 / 天使之光】通用SR · 战斗技能
 * 原文：受到攻击时，可消耗 2 点心境，将本次伤害降为 1
 * trigger: on_damage_calc  effect: reduce_damage_to_at_cost  MVP：若 mnd≥2 且预览伤害≥2，自动发动
 */
import type { SkillRegistration, HookHandler } from '../types';

export const skill_qianrenxue_tianshi: SkillRegistration = {
  id: 'sr_qianrenxue.battle',
  name: '天使之光',
  description: '受到攻击时，可消耗 2 点心境（永久）将本次伤害降为 1',
  hooks: {
    on_damage_calc: ((ctx, engine) => {
      const self = engine.getUnit(ctx.defender.id);
      if (!self || !self.skills.includes('sr_qianrenxue.battle')) return;
      if (self.mnd.current < 2) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'sr_qianrenxue.battle' },
          `天使之光无法启动——心境不足`,
          { actorId: self.id, skillId: 'sr_qianrenxue.battle', severity: 'info' },
        );
        return;
      }
      const preview = ctx.calcLog.reduce((s, x) => s + x.delta, ctx.aSum - ctx.dSum);
      if (preview <= 1) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'sr_qianrenxue.battle' },
          `天使之光待命——本次伤害已 ≤ 1`,
          { actorId: self.id, skillId: 'sr_qianrenxue.battle', severity: 'info' },
        );
        return;
      }
      // 消耗 mnd 2（永久，Q56 裁决）
      engine.changeStat(self.id, 'mnd', -2, {
        permanent: true,
        reason: '天使之光 消耗心境',
        skillId: 'sr_qianrenxue.battle',
      });
      ctx.calcLog.push({ source: '天使之光', delta: 1 - preview, note: `伤害降为 1` });
      engine.emit(
        'skill_passive_trigger',
        { skillId: 'sr_qianrenxue.battle', fromDmg: preview, toDmg: 1 },
        `天使之光：伤害 ${preview} 降为 1（自动发动 · 心境充足且伤害≥2）`,
        { actorId: self.id, skillId: 'sr_qianrenxue.battle', severity: 'highlight' },
      );
    }) as HookHandler,
  },
};
