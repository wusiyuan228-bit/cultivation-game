/**
 * 【邹翼 / 疯魔·灭杀】通用SSR · 战斗技能
 * 策划原文：判定结果+3，但每次进攻后自身受1点固定伤害
 * Q50：自伤可致死，不触发反伤
 */
import type { SkillRegistration, HookHandler } from '../types';

export const skill_zhouyi_fengmo: SkillRegistration = {
  id: 'ssr_zhouyi.battle',
  name: '疯魔·灭杀',
  description: '判定结果+3，但每次进攻后自身受1点固定伤害',
  hooks: {
    on_damage_calc: ((ctx, _engine) => {
      // BUGFIX（2026-05-01）：仅在本单位作为 attacker 时才生效
      if ((ctx as any).__firingUnitIsAttacker__ !== true) return;
      // 仅进攻方（ctx.attacker 是持有者）
      ctx.calcLog.push({
        source: 'ssr_zhouyi.battle',
        delta: +3,
        note: '疯魔·灭杀 +3',
      });
    }) as HookHandler,
    on_after_hit: ((ctx, engine) => {
      const self = engine.getUnit(ctx.attacker.id);
      if (!self) return;
      // 自伤走 stat_change（不触反伤，Q50）
      engine.changeStat(self.id, 'hp', -1, {
        permanent: false,
        reason: '疯魔·灭杀自伤',
        skillId: 'ssr_zhouyi.battle',
      });
      engine.emit(
        'skill_passive_trigger',
        { skillId: 'ssr_zhouyi.battle' },
        `「疯魔·灭杀」代价：${self.name} 气血 -1`,
        { actorId: self.id, skillId: 'ssr_zhouyi.battle', severity: 'info' },
      );
    }) as HookHandler,
  },
};
