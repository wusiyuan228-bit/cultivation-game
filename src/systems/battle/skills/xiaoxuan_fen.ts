/**
 * 【萧玄 / 萧族斗气·焚】SSR · 战斗技能
 *
 * 契约登记：
 *   策划原文：攻击妖修类敌人时，判定结果+3
 *   trigger  : on_damage_calc
 *   effect   : bonus_value (+3)
 *   condition: onlyWhenAttacking && onlyVsType='妖修'
 *
 * 未生效披露：目标非妖修 → skill_effect_blocked（T1）
 */
import type { SkillRegistration, HookHandler } from '../types';

export const skill_xiaoxuan_fen: SkillRegistration = {
  id: 'ssr_xiaoxuan.battle',
  name: '萧族斗气·焚',
  description: '攻击妖修类敌人时，判定结果+3',
  hooks: {
    on_damage_calc: ((ctx, engine) => {
      // BUGFIX（2026-05-01）：仅在本单位作为 attacker 时才生效
      if ((ctx as any).__firingUnitIsAttacker__ !== true) return;
      const defenderType = ctx.defender.type;
      if (defenderType !== '妖修') {
        // T1 未生效披露：目标非妖修
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'ssr_xiaoxuan.battle', reason: 'wrong_type', defenderType },
          `「萧族斗气·焚」未触发——目标非妖修类型`,
          { actorId: ctx.attacker.id, skillId: 'ssr_xiaoxuan.battle', severity: 'debug' },
        );
        return;
      }
      ctx.calcLog.push({
        source: 'ssr_xiaoxuan.battle',
        delta: +3,
        note: '萧族斗气·焚 +3（对妖修）',
      });
      engine.emit(
        'skill_passive_trigger',
        { skillId: 'ssr_xiaoxuan.battle' },
        `「萧族斗气·焚」触发，对妖修 ${ctx.defender.name} 判定结果 +3`,
        { actorId: ctx.attacker.id, skillId: 'ssr_xiaoxuan.battle', severity: 'info' },
      );
    }) as HookHandler,
  },
};
