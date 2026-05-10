/**
 * 【墨采寰 / 蓄力·彩环缚】通用SSR · 战斗技能
 * 策划原文：本行动轮不攻击，下一个行动轮修为+4（不可超过上限）
 */
import type { Modifier, SkillRegistration, TurnHookHandler } from '../types';
import { PRIORITY } from '../types';

export const skill_mocaihuan_xuli: SkillRegistration = {
  id: 'ssr_mocaihuan.battle',
  name: '蓄力·彩环缚',
  description: '本行动轮不攻击，下一个行动轮修为+4（不可超过上限）',
  hooks: {
    on_turn_end: ((tctx, engine) => {
      const self = engine.getUnit(tctx.unit.id);
      if (!self || !self.isAlive) return;
      // Q36：未攻击 = didBasicAttack=false && didUltimateAttack=false
      if (self.perTurn.didBasicAttack || self.perTurn.didUltimateAttack) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'ssr_mocaihuan.battle', reason: 'already_attacked' },
          `「蓄力·彩环缚」未触发——本行动轮已发起攻击`,
          { actorId: self.id, skillId: 'ssr_mocaihuan.battle', severity: 'info' },
        );
        return;
      }
      const mod: Modifier = {
        id: `mocaihuan_charge_${self.id}_${engine.getRound()}`,
        sourceSkillId: 'ssr_mocaihuan.battle',
        sourceUnitId: self.id,
        category: 'temporal',
        targetUnitId: self.id,
        kind: 'stat_delta',
        payload: { stat: 'atk', delta: +4, breakCap: false },
        duration: { type: 'next_turn', turnOwnerId: self.id },
        priority: PRIORITY.TEMPORAL,
      };
      engine.attachModifier(mod);
      engine.emit(
        'skill_passive_trigger',
        { skillId: 'ssr_mocaihuan.battle' },
        `「蓄力·彩环缚」触发，下回合修为 +4`,
        { actorId: self.id, skillId: 'ssr_mocaihuan.battle', severity: 'highlight' },
      );
    }) as TurnHookHandler,
  },
};
