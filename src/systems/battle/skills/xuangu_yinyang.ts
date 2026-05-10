/**
 * 【玄古 / 阴阳万解】通用SSR · 战斗技能
 * 策划原文：每次攻击后可重投1次骰子，取高判定结果（常驻）
 * Q35：仅限进攻方投骰
 * Q47：重投不再递归触发 on_after_roll 钩子（防死循环）
 *
 * 实装（P1 · 2026-05-01 精确版）：
 *   在 on_after_attack_roll 阶段，真实重投一次（独立 3 面骰），取高替换 ctx.aSum
 *   相比 MVP 版"近似取 atk×3 当重投高值"，现在严格按"重投取高"规则实现
 */
import type { SkillRegistration, HookHandler } from '../types';

/** 独立的 3 面骰重投（不依赖 resolveAttack 的内部函数） */
function rerollThreeFaceDice(count: number): number {
  let s = 0;
  const n = Math.max(1, count);
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 3);
  return s;
}

export const skill_xuangu_yinyang: SkillRegistration = {
  id: 'ssr_xuangu.battle',
  name: '阴阳万解',
  description: '每次攻击后可重投1次骰子，取高判定结果',
  hooks: {
    on_after_attack_roll: ((ctx, engine) => {
      const self = engine.getUnit(ctx.attacker.id);
      if (!self) return;
      // Q35：仅进攻方触发（穹古是攻方时）
      if ((ctx as any).__firingUnitIsAttacker__ !== true) return;

      // Q47：防递归，用 hookFiredSet 标记
      const key = `xuangu_reroll_${self.id}`;
      if (ctx.hookFiredSet.has(key)) return;
      ctx.hookFiredSet.add(key);

      // P1 精确版：真实重投一次（与 resolveAttack 使用相同的 rollDice 逻辑），取高替换
      const rerollSum = rerollThreeFaceDice(ctx.diceAttack);
      if (rerollSum > ctx.aSum) {
        engine.emit(
          'dice_roll_attack',
          { skillId: 'ssr_xuangu.battle', reroll: true, old: ctx.aSum, new: rerollSum, diceCount: ctx.diceAttack },
          `「阴阳万解」重投 ${ctx.diceAttack} 骰：${ctx.aSum} → ${rerollSum}（取高）`,
          { actorId: self.id, skillId: 'ssr_xuangu.battle', severity: 'info' },
        );
        ctx.aSum = rerollSum;
      } else {
        engine.emit(
          'dice_roll_attack',
          { skillId: 'ssr_xuangu.battle', reroll: true, old: ctx.aSum, new: rerollSum, kept: ctx.aSum },
          `「阴阳万解」重投 ${ctx.diceAttack} 骰：${ctx.aSum} vs ${rerollSum}，保留原值 ${ctx.aSum}`,
          { actorId: self.id, skillId: 'ssr_xuangu.battle', severity: 'info' },
        );
      }
    }) as HookHandler,
  },
};
