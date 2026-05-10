/**
 * 【修罗·塘散 / 修罗弑神击】主角觉醒 · 绝技
 *
 * 契约登记：
 *   策划原文：主动发动，选1名敌人，无视距离，投修为×2颗骰子进行攻击
 *   trigger  : active_once
 *   effect   : ranged_attack (range=unlimited, diceCount=self.atk*2)
 *   未生效披露：场上无敌人 → skill_active_cast 不消耗（Q5）
 *
 * 实装：activeCast(self, [targetId]) → 触发一次特殊 resolveAttack
 *       通过 ctx.skillId 标识本次为绝技直伤
 *       骰数覆盖：在 on_before_roll 里强行把 ctx.diceAttack 设为 self.atk*2
 */
import type { SkillRegistration, TargetSelector } from '../types';

export const skill_tangsan_shisha: SkillRegistration = {
  id: 'hero_tangsan.awaken.ultimate',
  name: '修罗弑神击',
  description: '主动发动，选1名敌人，无视距离，投"修为×2"颗骰子进行攻击',
  isActive: true,
  targetSelector: { kind: 'single_any_enemy' } satisfies TargetSelector,
  maxCasts: 1,
  hooks: {},
  precheck: (self, engine) => {
    if (self.ultimateUsed) return { ok: false, reason: '绝技已使用' };
    const enemies = engine.getEnemiesOf(self);
    if (enemies.length === 0) {
      return { ok: false, reason: '修罗弑神击发动失败——全场无敌方单位' };
    }
    return { ok: true, candidateIds: enemies.map((u) => u.id) };
  },
  activeCast: (self, targetIds, engine) => {
    const targetId = targetIds[0];
    if (!targetId) return { consumed: false };
    const target = engine.getUnit(targetId);
    if (!target || !target.isAlive) {
      engine.emit(
        'skill_effect_blocked',
        { skillId: 'hero_tangsan.awaken.ultimate', reason: 'target_invalid' },
        `修罗弑神击目标无效`,
        { actorId: self.id, skillId: 'hero_tangsan.awaken.ultimate', severity: 'info' },
      );
      return { consumed: false };
    }
    engine.emit(
      'skill_active_cast',
      { skillId: 'hero_tangsan.awaken.ultimate', targetId },
      `⚔️ ${self.name} 发动【修罗弑神击】→ ${target.name}（投 ${self.atk.current * 2} 骰）`,
      {
        actorId: self.id,
        targetIds: [targetId],
        skillId: 'hero_tangsan.awaken.ultimate',
        severity: 'climax',
      },
    );
    // 引擎层负责执行 resolveAttack，此处仅标记
    self.ultimateUsed = true;
    return { consumed: true };
  },
  followUpAttack: {
    target: 'first_only',
    diceOverride: (self) => self.atk.current * 2,
  },
};
