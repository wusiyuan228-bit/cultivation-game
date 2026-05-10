/**
 * 【沱森 / 古神·封印】通用SSR · 战斗技能
 * 策划原文：若本行动轮未移动，则对场上任意位置1名敌人造成2点固定伤害
 * Q52：未移动 = hasMoved=false（含主动+被动位移）
 */
import type { SkillRegistration, TurnHookHandler } from '../types';

export const skill_tuosen_fengyin: SkillRegistration = {
  id: 'ssr_tuosen.battle',
  name: '古神·封印',
  description: '若本行动轮未移动，则对场上任意位置1名敌人造成2点固定伤害',
  hooks: {
    on_turn_end: ((tctx, engine) => {
      const self = engine.getUnit(tctx.unit.id);
      if (!self || !self.isAlive) return;
      if (self.perTurn.hasMoved) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'ssr_tuosen.battle', reason: 'moved' },
          `「古神·封印」未触发——本行动轮已发生位移`,
          { actorId: self.id, skillId: 'ssr_tuosen.battle', severity: 'info' },
        );
        return;
      }
      const enemies = engine.getEnemiesOf(self).filter((u) => u.isAlive);
      if (enemies.length === 0) return;
      // MVP：选 hp 最低者
      enemies.sort((a, b) => a.hp.current - b.hp.current);
      const target = enemies[0];
      engine.emit(
        'skill_passive_trigger',
        { skillId: 'ssr_tuosen.battle' },
        `「古神·封印」触发，对 ${target.name} 造成 2 点固定伤害（自动选择 · hp最低的敌人）`,
        { actorId: self.id, targetIds: [target.id], skillId: 'ssr_tuosen.battle', severity: 'highlight' },
      );
      engine.changeStat(target.id, 'hp', -2, {
        permanent: false,
        reason: '古神·封印',
        skillId: 'ssr_tuosen.battle',
      });
    }) as TurnHookHandler,
  },
};
