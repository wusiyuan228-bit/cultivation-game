/**
 * 【塘昊 / 昊天锤·碎】绑定SSR · 战斗技能
 *
 * 契约登记：
 *   策划原文：攻击时，判定结果+1
 *   trigger  : on_damage_calc
 *   effect   : bonus_value (+1)
 *   condition: onlyWhenAttacking
 *   priority : TEMPORAL (20) —— §5.1 ①阶段攻方+项
 *
 * 战报规范：skill_passive_trigger + damage_calc 含 "昊天锤·碎 +1"
 */
import type { SkillRegistration, HookHandler } from '../types';

export const skill_tanghao_po: SkillRegistration = {
  id: 'bssr_tanghao.battle',
  name: '昊天锤·碎',
  description: '攻击时，判定结果+1',
  hooks: {
    on_damage_calc: ((ctx, engine) => {
      // BUGFIX（2026-05-01）：on_damage_calc 对攻/守双方都 fire，
      // "昊天锤·碎"只在本单位作为 attacker 时才 +1。
      if ((ctx as any).__firingUnitIsAttacker__ !== true) return;
      if (ctx.attackKind !== 'basic' && !ctx.viaUltimate) return; // 普攻 / 绝技攻击均生效
      ctx.calcLog.push({
        source: 'bssr_tanghao.battle',
        delta: +1,
        note: '昊天锤·碎 +1',
      });
      engine.emit(
        'skill_passive_trigger',
        { skillId: 'bssr_tanghao.battle' },
        `「昊天锤·碎」触发，判定结果 +1`,
        { actorId: ctx.attacker.id, skillId: 'bssr_tanghao.battle', severity: 'info' },
      );
    }) as HookHandler,
  },
};
