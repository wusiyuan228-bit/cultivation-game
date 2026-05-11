/**
 * 【天蕴子 / 天运·命格逆转】通用SSR · 战斗技能
 * 策划原文：行动轮开始时，可选1名相邻敌人，使其修为-1（永久，最低为1）
 * 2026-05-11：新增 interactiveOnTurnStart，玩家可手动选相邻敌
 */
import type { SkillRegistration, TurnHookHandler } from '../types';

export const skill_tianyunzi_minge: SkillRegistration = {
  id: 'ssr_tianyunzi.battle',
  name: '天运·命格逆转',
  description: '行动轮开始时，可选1名相邻敌人，使其修为-1（永久，最低为1）',
  interactiveOnTurnStart: {
    promptTitle: '天运·命格逆转',
    promptBody: '行动开始前可使 1 名相邻敌人修为永久 -1（最低 1）。是否发动？',
    collectChoices: (self, engine) => {
      const adj = engine
        .getEnemiesOf(self)
        .filter(
          (u) =>
            u.isAlive &&
            Math.abs(u.row - self.row) + Math.abs(u.col - self.col) === 1 &&
            u.atk.current > 1,
        );
      return adj.map((u) => ({ targetId: u.id })); // 固定降 atk，无需选属性
    },
    apply: (self, target, _stat, engine) => {
      engine.changeStat(target.id, 'atk', -1, {
        permanent: true,
        floor: 1,
        reason: '天运·命格逆转',
        skillId: 'ssr_tianyunzi.battle',
      });
      engine.emit(
        'skill_passive_trigger',
        { skillId: 'ssr_tianyunzi.battle' },
        `「天运·命格逆转」：${self.name} → ${target.name} 修为永久 -1（玩家选择）`,
        {
          actorId: self.id,
          targetIds: [target.id],
          skillId: 'ssr_tianyunzi.battle',
          severity: 'info',
        },
      );
    },
  },
  hooks: {
    on_turn_start: ((tctx, engine) => {
      const self = engine.getUnit(tctx.unit.id);
      if (!self || !self.isAlive) return;
      const adj = engine
        .getEnemiesOf(self)
        .filter(
          (u) => u.isAlive && Math.abs(u.row - self.row) + Math.abs(u.col - self.col) === 1,
        );
      if (adj.length === 0) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'ssr_tianyunzi.battle', reason: 'no_adj' },
          `「天运·命格逆转」未触发——相邻无敌方`,
          { actorId: self.id, skillId: 'ssr_tianyunzi.battle', severity: 'info' },
        );
        return;
      }
      // MVP：选 atk 最高者
      adj.sort((a, b) => b.atk.current - a.atk.current);
      const target = adj[0];
      if (target.atk.current <= 1) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'ssr_tianyunzi.battle', reason: 'target_atk_min' },
          `${target.name} 修为已为 1，天运·命格逆转未生效`,
          { actorId: self.id, targetIds: [target.id], skillId: 'ssr_tianyunzi.battle', severity: 'info' },
        );
        return;
      }
      engine.emit(
        'skill_passive_trigger',
        { skillId: 'ssr_tianyunzi.battle' },
        `「天运·命格逆转」触发，${target.name} 修为永久 -1（自动选择 · atk最高的相邻敌）`,
        { actorId: self.id, targetIds: [target.id], skillId: 'ssr_tianyunzi.battle', severity: 'info' },
      );
      engine.changeStat(target.id, 'atk', -1, {
        permanent: true,
        floor: 1,
        reason: '天运·命格逆转',
        skillId: 'ssr_tianyunzi.battle',
      });
    }) as TurnHookHandler,
  },
};
