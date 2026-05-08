/**
 * 【萧焱 / 焚决·噬焰】主角本体 · 战斗技能
 *
 * 契约登记：
 *   策划原文：进攻时，吞噬目标1点修为（目标修为永久-1，最低为1；自身修为永久+1，可突破上限）
 *   trigger  : on_after_hit
 *   effect   : devour_atk
 *   Q9 裁决 ：目标 atk=1 时双方都不变，handler 前置检查 emit skill_effect_blocked
 *   Q2 裁决 ：目标已 hp≤0 不挂载 debuff，披露 T4
 *
 * 实装：on_after_hit 触发，两次 changeStat（target.atk -1 permanent，self.atk +1 permanent breakCap）
 */
import type { SkillRegistration, HookHandler } from '../types';

export const skill_xiaoyan_shiyan: SkillRegistration = {
  id: 'hero_xiaoyan.battle',
  name: '焚决·噬焰',
  description: '进攻时，吞噬目标1点修为（目标修为永久-1，最低为1；自身修为永久+1，可突破上限）',
  hooks: {
    on_after_hit: ((ctx, engine) => {
      const attacker = engine.getUnit(ctx.attacker.id);
      const defender = engine.getUnit(ctx.defender.id);
      if (!attacker || !defender) return;

      // Q2：目标已退场（hp ≤ 0 即将 unit_leave）→ 不挂载 debuff，T4 披露
      if (defender.hp.current <= 0 || !defender.isAlive) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'hero_xiaoyan.battle', reason: 'target_leaving' },
          `「焚决·噬焰」未生效——${defender.name} 已退场`,
          { actorId: attacker.id, targetIds: [defender.id], skillId: 'hero_xiaoyan.battle', severity: 'info' },
        );
        return;
      }

      // Q9：目标 atk=1 时，吞噬未生效，双方均无变化
      if (defender.atk.current <= 1) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'hero_xiaoyan.battle', reason: 'target_atk_min', defenderAtk: defender.atk.current },
          `「焚决·噬焰」未触发——${defender.name} 修为已为 1`,
          { actorId: attacker.id, targetIds: [defender.id], skillId: 'hero_xiaoyan.battle', severity: 'info' },
        );
        return;
      }

      engine.emit(
        'skill_passive_trigger',
        { skillId: 'hero_xiaoyan.battle' },
        `「焚决·噬焰」触发，吞噬 ${defender.name} 1 点修为`,
        { actorId: attacker.id, targetIds: [defender.id], skillId: 'hero_xiaoyan.battle', severity: 'highlight' },
      );

      // 目标 atk -1 永久（floor=1）
      engine.changeStat(defender.id, 'atk', -1, {
        permanent: true,
        floor: 1,
        reason: '焚决·噬焰吞噬',
        skillId: 'hero_xiaoyan.battle',
      });
      // 自身 atk +1 永久（可突破上限）
      engine.changeStat(attacker.id, 'atk', +1, {
        permanent: true,
        breakCap: true,
        reason: '焚决·噬焰吞噬',
        skillId: 'hero_xiaoyan.battle',
      });

      engine.emit(
        'skill_effect_applied',
        { skillId: 'hero_xiaoyan.battle' },
        `「焚决·噬焰」生效：${defender.name} 修为 -1，${attacker.name} 修为 +1`,
        { actorId: attacker.id, targetIds: [defender.id], skillId: 'hero_xiaoyan.battle', severity: 'highlight' },
      );
    }) as HookHandler,
  },
};
