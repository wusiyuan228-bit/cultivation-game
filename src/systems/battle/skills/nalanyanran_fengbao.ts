/**
 * 【纳兰艳然 / 风暴裂斩】通用SR · SR绝技
 * 原文：主动发动，对 2 格内的敌人进行攻击，本次攻击 atk+2（不可超上限）
 */
import type { SkillRegistration, BattleUnit, IBattleEngine, Modifier } from '../types';
import { PRIORITY } from '../types';

export const skill_nalanyanran_fengbao: SkillRegistration = {
  id: 'sr_nalanyanran.ultimate',
  name: '风暴裂斩',
  description: '对 2 格内敌人攻击，本次攻击 atk+2（不可超上限）',
  isActive: true,
  maxCasts: 1,
  targetSelector: { kind: 'single_any_enemy' },
  precheck: (self: BattleUnit, engine: IBattleEngine) => {
    const inRange = engine
      .getEnemiesOf(self)
      .filter((e) => e.isAlive && Math.abs(e.row - self.row) + Math.abs(e.col - self.col) <= 2);
    return inRange.length > 0
      ? { ok: true, candidateIds: inRange.map((u) => u.id) }
      : { ok: false, reason: '2格内无敌方' };
  },
  activeCast: (self: BattleUnit, targetIds: string[], engine: IBattleEngine) => {
    const target = engine.getUnit(targetIds[0]);
    if (!target) return { consumed: false };
    const buff: Modifier = {
      id: `fbls_${self.id}_${engine.nextSeq()}`,
      sourceSkillId: 'sr_nalanyanran.ultimate',
      sourceUnitId: self.id,
      category: 'temporal',
      targetUnitId: self.id,
      kind: 'stat_delta',
      payload: { stat: 'atk', delta: 2, clampTo: 9 },
      duration: { type: 'this_attack' },
      priority: PRIORITY.TEMPORAL,
    };
    engine.attachModifier(buff);
    engine.emit(
      'skill_active_cast',
      { skillId: 'sr_nalanyanran.ultimate' },
      `风暴裂斩：${self.name} 对 ${target.name} 发动强攻（atk+2）`,
      { actorId: self.id, targetIds: [target.id], skillId: 'sr_nalanyanran.ultimate', severity: 'climax' },
    );
    return { consumed: true };
  },
  hooks: {},
  followUpAttack: { target: 'first_only' },
};
