/**
 * 【二明 / 泰坦巨猿·铁壁】绑定SSR · 战斗技能
 *
 * 策划原文：被攻击伤害结算后，自动对攻击方造成2点固定反弹伤害
 *           （技能直接伤害不触发；多段攻击每段独立反弹）
 *
 * 契约登记：
 *   trigger  : on_after_being_hit
 *   effect   : reflect_damage
 *   condition: ctx.attackKind === 'basic'（溅射/技能/反伤 均不触发）
 *   裁决 Q27 ：先反伤再死亡；Phase 6 仍保留 defender.isAlive=true 即使 hp≤0
 *   裁决 Q38 ：溅射伤害（ctx.attackKind='skill_damage' & noChain）不触发反伤
 *   裁决 Q38+终局：任何非 basic 的攻击链都不触发反伤（全局原则）
 */
import type { SkillRegistration, HookHandler } from '../types';

export const skill_erming_tiebi: SkillRegistration = {
  id: 'bssr_erming.battle',
  name: '泰坦巨猿·铁壁',
  description: '被攻击伤害结算后，自动对攻击方造成2点固定反弹伤害（技能直接伤害不触发；多段独立）',
  hooks: {
    on_after_being_hit: ((ctx, engine) => {
      const self = engine.getUnit(ctx.defender.id);
      const attacker = engine.getUnit(ctx.attacker.id);
      if (!self || !attacker) return;

      // Q38/全局：仅 basic 普通攻击触发反伤（技能直伤、反伤、溅射、自伤 均不触发）
      if (ctx.attackKind !== 'basic') {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'bssr_erming.battle', reason: 'non_basic_damage', attackKind: ctx.attackKind },
          `「泰坦巨猿·铁壁」未触发——伤害来源非普通攻击`,
          { actorId: self.id, targetIds: [attacker.id], skillId: 'bssr_erming.battle', severity: 'info' },
        );
        return;
      }

      // 攻击方已退场（自爆 / 献祭同归）→ 反弹落空
      if (!attacker.isAlive) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'bssr_erming.battle', reason: 'attacker_left' },
          `「泰坦巨猿·铁壁」反弹目标已退场，反弹伤害落空`,
          { actorId: self.id, skillId: 'bssr_erming.battle', severity: 'info' },
        );
        return;
      }

      engine.emit(
        'skill_passive_trigger',
        { skillId: 'bssr_erming.battle' },
        `「泰坦巨猿·铁壁」触发，反弹 2 点固定伤害至 ${attacker.name}`,
        { actorId: self.id, targetIds: [attacker.id], skillId: 'bssr_erming.battle', severity: 'highlight' },
      );

      // 反弹伤害走 stat_change 路径（不再走 resolveAttack，避免递归）
      engine.changeStat(attacker.id, 'hp', -2, {
        permanent: false,
        reason: '泰坦巨猿·铁壁反弹',
        skillId: 'bssr_erming.battle',
      });
    }) as HookHandler,
  },
};
