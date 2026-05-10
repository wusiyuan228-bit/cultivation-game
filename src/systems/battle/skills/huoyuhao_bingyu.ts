/**
 * 【霍宇皓 / 冰碧帝皇蝎·域】通用SSR · 战斗技能
 * 策划原文：行动轮结束时，所有相邻敌人的下一个行动轮无法移动
 */
import type { Modifier, SkillRegistration, TurnHookHandler } from '../types';
import { PRIORITY } from '../types';

export const skill_huoyuhao_bingyu: SkillRegistration = {
  id: 'ssr_huoyuhao.battle',
  name: '冰碧帝皇蝎·域',
  description: '行动轮结束时，所有相邻敌人的下一个行动轮无法移动',
  hooks: {
    on_turn_end: ((tctx, engine) => {
      const self = engine.getUnit(tctx.unit.id);
      if (!self || !self.isAlive) return;
      const adjEnemies = engine
        .getEnemiesOf(self)
        .filter(
          (u) => u.isAlive && Math.abs(u.row - self.row) + Math.abs(u.col - self.col) === 1,
        );
      if (adjEnemies.length === 0) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'ssr_huoyuhao.battle', reason: 'no_adj_enemy' },
          `「冰碧帝皇蝎·域」未触发——相邻无敌方`,
          { actorId: self.id, skillId: 'ssr_huoyuhao.battle', severity: 'info' },
        );
        return;
      }
      engine.emit(
        'skill_passive_trigger',
        { skillId: 'ssr_huoyuhao.battle' },
        `「冰碧帝皇蝎·域」触发，冻结 ${adjEnemies.length} 个相邻敌方`,
        {
          actorId: self.id,
          targetIds: adjEnemies.map((u) => u.id),
          skillId: 'ssr_huoyuhao.battle',
          severity: 'info',
        },
      );
      for (const e of adjEnemies) {
        const mod: Modifier = {
          id: `huoyuhao_freeze_${e.id}_${engine.getRound()}`,
          sourceSkillId: 'ssr_huoyuhao.battle',
          sourceUnitId: self.id,
          category: 'temporal',
          targetUnitId: e.id,
          kind: 'disable_move',
          payload: {},
          duration: { type: 'next_turn', turnOwnerId: e.id },
          priority: PRIORITY.TEMPORAL,
        };
        engine.attachModifier(mod);
      }
    }) as TurnHookHandler,
  },
};
