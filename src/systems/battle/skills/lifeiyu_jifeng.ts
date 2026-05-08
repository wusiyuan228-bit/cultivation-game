/**
 * 【厉飞雨 / 疾风无影】通用SR · 战斗技能（battle_skill）
 * 原文：与你交战的角色的普通技能（battle_skill）对你失效
 * Q60：仅压制攻击方自身的"被动 battle_skill"；绝技 (ultimate/awaken_ult) 仍生效
 *
 * 实装：
 *   - Phase 4（on_before_being_attacked）把 ctx.suppressAttackerBattleSkill 置 true
 *   - resolveAttack.collectHooks 读到该标记后，对"攻方"这一侧跳过所有
 *     kind='battle_skill' | 'awaken_skill' 的 hook handler
 *   - 对绝技攻击（ctx.viaUltimate）不生效
 *
 * 注：本技能本身是被动 battle_skill，挂在守方；触发时机早于攻方 Phase 5 的
 * on_damage_calc，因此能阻止攻方被动加成（如昊天锤、斗气焚等）对本次攻击生效。
 */
import type { SkillRegistration, HookHandler } from '../types';

export const skill_lifeiyu_jifeng: SkillRegistration = {
  id: 'sr_lifeiyu.battle',
  name: '疾风无影',
  description: '与你交战角色的普通 battle_skill 对你失效（绝技仍生效）',
  kind: 'battle_skill',
  hooks: {
    on_before_being_attacked: ((ctx, engine) => {
      const self = engine.getUnit(ctx.defender.id);
      if (!self || !self.skills.includes('sr_lifeiyu.battle')) return;
      if (ctx.viaUltimate) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'sr_lifeiyu.battle' },
          `疾风无影不生效——本次为绝技攻击`,
          { actorId: self.id, skillId: 'sr_lifeiyu.battle', severity: 'info' },
        );
        return;
      }
      // 真实消费点在 resolveAttack.collectHooks：读到该标记后跳过攻方的被动 battle_skill hook
      (ctx as unknown as Record<string, unknown>).suppressAttackerBattleSkill = true;
      engine.emit(
        'skill_passive_trigger',
        { skillId: 'sr_lifeiyu.battle' },
        `疾风无影：屏蔽 ${ctx.attacker.name} 的 battle_skill 被动效果`,
        { actorId: self.id, targetIds: [ctx.attacker.id], skillId: 'sr_lifeiyu.battle', severity: 'highlight' },
      );
    }) as HookHandler,
  },
};
