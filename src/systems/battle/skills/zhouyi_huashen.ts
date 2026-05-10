/**
 * 【邹翼 / 疯魔化身】通用SSR · 绝技
 * 策划原文：主动发动，可扣除自身X点气血（X≤当前气血-1），本次攻击判定结果额外+X
 * Q51：发动后不攻击即作废（不补偿 hp）
 * MVP：X = hp - 1（最大化）
 */
import type { Modifier, SkillRegistration } from '../types';
import { PRIORITY } from '../types';

export const skill_zhouyi_huashen: SkillRegistration = {
  id: 'ssr_zhouyi.ult',
  name: '疯魔化身',
  description: '主动发动，扣除自身X点气血，本次攻击判定结果额外+X',
  isActive: true,
  targetSelector: { kind: 'none' },
  maxCasts: 1,
  precheck: (self) => {
    if (self.hp.current < 2) return { ok: false, reason: '气血不足（需 ≥2）' };
    return { ok: true };
  },
  activeCast: (self, _targetIds, engine) => {
    const X = self.hp.current - 1;
    if (X < 1) return { consumed: false };
    engine.changeStat(self.id, 'hp', -X, {
      permanent: false,
      reason: '疯魔化身消耗',
      skillId: 'ssr_zhouyi.ult',
    });
    const mod: Modifier = {
      id: `huashen_${self.id}_${engine.getRound()}`,
      sourceSkillId: 'ssr_zhouyi.ult',
      sourceUnitId: self.id,
      category: 'temporal',
      targetUnitId: self.id,
      kind: 'damage_bonus',
      payload: { delta: +X, onAttack: true },
      duration: { type: 'this_turn', turnOwnerId: self.id }, // Q51 当前轮不攻击即作废
      priority: PRIORITY.TEMPORAL,
    };
    engine.attachModifier(mod);
    engine.emit(
      'skill_active_cast',
      { skillId: 'ssr_zhouyi.ult', X },
      `「疯魔化身」发动：消耗 ${X} 点气血，本次攻击判定 +${X}`,
      { actorId: self.id, skillId: 'ssr_zhouyi.ult', severity: 'climax' },
    );
    return { consumed: true };
  },
  hooks: {},
};
