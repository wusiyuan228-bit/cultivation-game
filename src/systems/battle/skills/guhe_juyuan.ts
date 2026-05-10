/**
 * 【顾河 / 炼药·聚元炉】通用SR · 战斗技能
 * 原文：行动轮开始时，可指定任意 1 名相邻友军，本行动轮进攻后可重投 1 次骰子取较高
 * MVP：自动给任一相邻友军挂 grant_reroll
 */
import type { SkillRegistration, TurnHookHandler, Modifier } from '../types';
import { PRIORITY } from '../types';

export const skill_guhe_juyuan: SkillRegistration = {
  id: 'sr_guhe.battle',
  name: '炼药·聚元炉',
  description: '行动轮开始时，可指定 1 名相邻友军重投攻击骰',
  hooks: {
    on_turn_start: ((ctx, engine) => {
      const self = ctx.unit;
      if (!self.isAlive || !self.skills.includes('sr_guhe.battle')) return;
      const adj = engine
        .getAlliesOf(self)
        .filter(
          (u) => u.isAlive && u.id !== self.id && Math.abs(u.row - self.row) + Math.abs(u.col - self.col) === 1,
        );
      if (adj.length === 0) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'sr_guhe.battle' },
          `炼药·聚元炉未触发——无相邻友军`,
          { actorId: self.id, skillId: 'sr_guhe.battle', severity: 'info' },
        );
        return;
      }
      const target = adj[0];
      const mod: Modifier = {
        id: `juyuan_${target.id}_${engine.nextSeq()}`,
        sourceSkillId: 'sr_guhe.battle',
        sourceUnitId: self.id,
        category: 'reactive',
        targetUnitId: target.id,
        kind: 'grant_reroll',
        payload: { remaining: 1 },
        duration: { type: 'this_turn', turnOwnerId: target.id },
        priority: PRIORITY.TEMPORAL,
      };
      engine.attachModifier(mod);
      engine.emit(
        'skill_passive_trigger',
        { skillId: 'sr_guhe.battle' },
        `炼药·聚元炉：${target.name} 本轮进攻后可重投 1 次（自动选择 · 首个相邻友军）`,
        { actorId: self.id, targetIds: [target.id], skillId: 'sr_guhe.battle', severity: 'highlight' },
      );
    }) as TurnHookHandler,
  },
};
