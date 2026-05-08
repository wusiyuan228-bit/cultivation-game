/**
 * 【南宫婉 / 万花灵阵】绑定SSR · 战斗技能（反应式）
 *
 * 策划原文：被进攻时，可消耗自身1点气血，使本次攻击方修为值减半（向下取整，仅本次判定）
 *
 * 契约登记：
 *   trigger  : on_before_being_attacked
 *   effect   : reactive_halve_atk (this_attack)
 *   cost.hp  : 1（Q39 前置：hp ≥ 2 才可发动）
 *   裁决 Q31 ：人类每次触发弹窗询问；AI 自动抉择（此处 MVP 走 AI 默认：启动）
 *
 * 实装说明：
 *   - 在 on_before_being_attacked 阶段将 ctx.attacker.atk 的临时值减半
 *   - 通过 calcLog 记录即可，或直接修改 ctx.diceAttack（此处按 atk 减半 → 重算骰数）
 *   - MVP 简化：直接记 calcLog 的 delta = -ceil(atk/2)（等价于 floor(atk/2)）
 */
import type { SkillRegistration, HookHandler } from '../types';

export const skill_nangongwan_wanhua: SkillRegistration = {
  id: 'bssr_nangongwan.battle',
  name: '万花灵阵',
  description: '被进攻时，可消耗自身1点气血，使本次攻击方修为值减半（向下取整，仅本次判定）',
  hooks: {
    on_before_being_attacked: ((ctx, engine) => {
      const self = engine.getUnit(ctx.defender.id);
      const attacker = engine.getUnit(ctx.attacker.id);
      if (!self || !attacker) return;

      // Q39：hp 必须 ≥ 2 才能发动（消耗后留 ≥1）
      if (self.hp.current < 2) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'bssr_nangongwan.battle', reason: 'hp_too_low' },
          `「万花灵阵」无法启动——气血不足（需消耗1点）`,
          { actorId: self.id, skillId: 'bssr_nangongwan.battle', severity: 'info' },
        );
        return;
      }

      // MVP 默认启动（人类弹窗由 UI 层后续接入；AI 自动启动）
      const halved = Math.floor(attacker.atk.current / 2);
      const delta = halved - attacker.atk.current; // 负值

      engine.changeStat(self.id, 'hp', -1, {
        permanent: false,
        reason: '万花灵阵消耗',
        skillId: 'bssr_nangongwan.battle',
      });
      engine.emit(
        'skill_passive_trigger',
        { skillId: 'bssr_nangongwan.battle', atkBefore: attacker.atk.current, atkAfter: halved },
        `「万花灵阵」触发，${attacker.name} 修为 ${attacker.atk.current} → ${halved}（仅本次判定）（自动发动 · hp≥2 时默认启动）`,
        { actorId: self.id, targetIds: [attacker.id], skillId: 'bssr_nangongwan.battle', severity: 'highlight' },
      );

      // 通过 calcLog 在 damage_calc 阶段减少对方伤害（等价于减 atk）
      ctx.calcLog.push({
        source: 'bssr_nangongwan.battle',
        delta, // 负值
        note: `万花灵阵：攻方修为减半（${attacker.atk.current}→${halved}）`,
      });
    }) as HookHandler,
  },
};
