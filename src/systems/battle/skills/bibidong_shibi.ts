/**
 * 【比比东 / 死蛛皇·噬】通用SSR · 战斗技能
 * 策划原文：进攻时，永久降低目标1点修为（最低为1）
 */
import type { SkillRegistration, HookHandler } from '../types';

export const skill_bibidong_shibi: SkillRegistration = {
  id: 'ssr_bibidong.battle',
  name: '死蛛皇·噬',
  description: '进攻时，永久降低目标1点修为（最低为1）',
  hooks: {
    on_after_hit: ((ctx, engine) => {
      const attacker = engine.getUnit(ctx.attacker.id);
      const defender = engine.getUnit(ctx.defender.id);
      if (!attacker || !defender) return;
      if (defender.hp.current <= 0 || !defender.isAlive) return;
      if (defender.atk.current <= 1) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'ssr_bibidong.battle', reason: 'target_atk_min' },
          `${defender.name} 修为已为 1，死蛛皇·噬未生效`,
          { actorId: attacker.id, targetIds: [defender.id], skillId: 'ssr_bibidong.battle', severity: 'info' },
        );
        return;
      }
      engine.emit(
        'skill_passive_trigger',
        { skillId: 'ssr_bibidong.battle' },
        `「死蛛皇·噬」触发，${defender.name} 修为永久 -1`,
        { actorId: attacker.id, targetIds: [defender.id], skillId: 'ssr_bibidong.battle', severity: 'highlight' },
      );
      engine.changeStat(defender.id, 'atk', -1, {
        permanent: true,
        floor: 1,
        reason: '死蛛皇·噬',
        skillId: 'ssr_bibidong.battle',
      });
    }) as HookHandler,
  },
};
