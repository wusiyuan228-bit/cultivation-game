/**
 * 【旺林 / 邪灵诀·夺命】主角本体 · 战斗技能
 *
 * 契约登记：
 *   策划原文：进攻时，吸取目标1点气血回复自身（可突破气血上限）
 *   trigger  : on_after_hit
 *   effect   : lifesteal
 *   Q15 裁决：必须 damage>0 才触发
 *   canBreakCap = true
 *
 * 披露：
 *   - damage=0 时：skill_effect_blocked（T10 等价空转）
 *   - 自身已满血且 canBreakCap：正常+1，不披露
 */
import type { SkillRegistration, HookHandler } from '../types';

export const skill_wanglin_duoming: SkillRegistration = {
  id: 'hero_wanglin.battle',
  name: '邪灵诀·夺命',
  description: '进攻时，吸取目标1点气血回复自身（可突破气血上限）',
  hooks: {
    on_after_hit: ((ctx, engine) => {
      const attacker = engine.getUnit(ctx.attacker.id);
      const defender = engine.getUnit(ctx.defender.id);
      if (!attacker || !defender) return;

      // 读取本次攻击实际造成的伤害（由 resolveAttack 写入 ctx.calcLog 末的 finalDamage）
      const thisHitDamage = (ctx.calcLog.find((l: { source: string; delta: number }) => l.source === '__final_damage__')?.delta) ?? 0;

      if (thisHitDamage <= 0) {
        // Q15：未造成有效伤害，披露 T10
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'hero_wanglin.battle', reason: 'zero_damage' },
          `「邪灵诀·夺命」未触发——本次攻击未造成有效伤害`,
          { actorId: attacker.id, targetIds: [defender.id], skillId: 'hero_wanglin.battle', severity: 'info' },
        );
        return;
      }

      engine.emit(
        'skill_passive_trigger',
        { skillId: 'hero_wanglin.battle' },
        `「邪灵诀·夺命」触发，吸取 ${defender.name} 1 点气血`,
        { actorId: attacker.id, targetIds: [defender.id], skillId: 'hero_wanglin.battle', severity: 'highlight' },
      );

      engine.changeStat(attacker.id, 'hp', +1, {
        permanent: true,
        breakCap: true,
        reason: '邪灵诀·夺命吸血',
        skillId: 'hero_wanglin.battle',
      });

      engine.emit(
        'skill_effect_applied',
        { skillId: 'hero_wanglin.battle' },
        `「邪灵诀·夺命」生效：${attacker.name} 气血 +1（可突破上限）`,
        { actorId: attacker.id, targetIds: [defender.id], skillId: 'hero_wanglin.battle', severity: 'highlight' },
      );
    }) as HookHandler,
  },
};
