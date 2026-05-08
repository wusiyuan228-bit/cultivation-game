/**
 * 【元婴·寒立 / 噬金虫群】主角觉醒 · 战斗技能
 *
 * 契约登记：
 *   策划原文：进攻时造成的伤害×2（判定结果翻倍）
 *   trigger  : on_damage_calc
 *   effect   : damage_multiplier (×2)
 *   Q24 裁决：最终伤害 damage×2（aSum - dSum + Σbonuses 之后再 ×2），
 *             在 §5.1 ③阶段应用（守方翻倍/减半类的兄弟位置）
 *
 * 实装：在 ctx.calcLog 中塞入 kind='multiplier'（本轮 §5.1 ③阶段用），
 *       resolveAttack 的 damage 计算会识别该 marker 并执行 ×2
 */
import type { SkillRegistration, HookHandler } from '../types';

export const skill_hanli_aw_chongjin: SkillRegistration = {
  id: 'hero_hanli.awaken.battle',
  name: '噬金虫群',
  description: '进攻时造成的伤害×2（判定结果翻倍）',
  hooks: {
    on_damage_calc: ((ctx, engine) => {
      // BUGFIX（2026-05-01）：若不判断身份，寒立作为被攻击方时，攻击者伤害会被 ×2！
      if ((ctx as any).__firingUnitIsAttacker__ !== true) return;
      // 走特殊 source 名 '__multiplier__'，resolveAttack 会识别并在 ③阶段处理
      ctx.calcLog.push({
        source: 'hero_hanli.awaken.battle__multiplier__',
        delta: 2, // 翻倍因子
        note: '噬金虫群：伤害 ×2',
      });
      engine.emit(
        'skill_passive_trigger',
        { skillId: 'hero_hanli.awaken.battle', multiplier: 2 },
        `「噬金虫群」触发，本次伤害 ×2`,
        { actorId: ctx.attacker.id, skillId: 'hero_hanli.awaken.battle', severity: 'highlight' },
      );
    }) as HookHandler,
  },
};
