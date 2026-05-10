/**
 * 【千刃雪 / 天使圣剑】通用SR · SR绝技
 * 原文：主动发动，全场任意1名敌人进行攻击，本次攻击自身修为+4（不可超上限）
 */
import type { SkillRegistration, BattleUnit, IBattleEngine, Modifier } from '../types';
import { PRIORITY } from '../types';

export const skill_qianrenxue_shengjian: SkillRegistration = {
  id: 'sr_qianrenxue.ultimate',
  name: '天使圣剑',
  description: '主动发动：任选 1 敌攻击，本次攻击 atk+4（不可超上限）',
  isActive: true,
  maxCasts: 1,
  targetSelector: { kind: 'single_any_enemy' },
  precheck: (self: BattleUnit, engine: IBattleEngine) => {
    const enemies = engine.getEnemiesOf(self).filter((u) => u.isAlive);
    return enemies.length > 0
      ? { ok: true, candidateIds: enemies.map((u) => u.id) }
      : { ok: false, reason: '场上无可选敌人' };
  },
  activeCast: (self: BattleUnit, targetIds: string[], engine: IBattleEngine) => {
    const target = engine.getUnit(targetIds[0]);
    if (!target) return { consumed: false };
    // 临时 +4 atk（this_attack，不可破上限——engine 内部 clamp）
    const buff: Modifier = {
      id: `tmp_${self.id}_shengjian_${engine.nextSeq()}`,
      sourceSkillId: 'sr_qianrenxue.ultimate',
      sourceUnitId: self.id,
      category: 'temporal',
      targetUnitId: self.id,
      kind: 'stat_delta',
      payload: { stat: 'atk', delta: 4, clampTo: 9 },
      duration: { type: 'this_attack' },
      priority: PRIORITY.TEMPORAL,
    };
    engine.attachModifier(buff);
    engine.emit(
      'skill_active_cast',
      { skillId: 'sr_qianrenxue.ultimate', targets: [target.id] },
      `天使圣剑：${self.name} 本次攻击 atk+4，冲向 ${target.name}`,
      { actorId: self.id, targetIds: [target.id], skillId: 'sr_qianrenxue.ultimate', severity: 'climax' },
    );
    // 攻击由 store 层 performUltimate 后置发起（已通过 followUpAttack 声明）
    return { consumed: true };
  },
  hooks: {},
  followUpAttack: { target: 'first_only' },
};
