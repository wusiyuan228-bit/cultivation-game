/**
 * 【修罗·塘散 / 修罗瞳·支配】主角觉醒 · 战斗技能
 *
 * 契约登记：
 *   策划原文：所有判定结果+2（常驻）
 *   trigger  : passive（觉醒上场即生效）
 *   effect   : extra_dice_all_rolls（攻防双向 +2 骰）
 *   Q17 裁决：「判定」=投骰数量；攻/防双向均 +2
 *   canBreakCap = true（骰数不受 atk 上限约束）
 *
 * 实装方式：挂载 2 个 hook（on_before_roll + on_before_defend_roll）
 */
import type { SkillRegistration, HookHandler } from '../types';

export const skill_xiuluo_zhipei: SkillRegistration = {
  id: 'hero_tangsan.awaken.battle',
  name: '修罗瞳·支配',
  description: '所有判定结果+2（常驻，攻防双向）',
  hooks: {
    on_before_roll: ((ctx, engine) => {
      // 进攻骰 +2
      ctx.diceAttack += 2;
      engine.emit(
        'skill_passive_trigger',
        { skillId: 'hero_tangsan.awaken.battle', side: 'attack', bonus: +2 },
        `「修罗瞳·支配」常驻生效，进攻骰数 +2`,
        { actorId: ctx.attacker.id, skillId: 'hero_tangsan.awaken.battle', severity: 'info' },
      );
    }) as HookHandler,
    on_before_defend_roll: ((ctx, engine) => {
      // 防守骰 +2
      ctx.diceDefend += 2;
      engine.emit(
        'skill_passive_trigger',
        { skillId: 'hero_tangsan.awaken.battle', side: 'defend', bonus: +2 },
        `「修罗瞳·支配」常驻生效，防守骰数 +2`,
        { actorId: ctx.defender.id, skillId: 'hero_tangsan.awaken.battle', severity: 'info' },
      );
    }) as HookHandler,
  },
};
