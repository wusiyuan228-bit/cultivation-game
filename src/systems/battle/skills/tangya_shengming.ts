/**
 * 【唐雅 / 蓝银皇·生命赐福】绑定SR · 绝技
 *
 * 策划原文：主动发动，选1名友军，使其下一个行动轮可以行动2次
 *
 * 契约登记：
 *   trigger  : active_once
 *   effect   : extra_action_next_turn
 */
import type { Modifier, SkillRegistration } from '../types';
import { PRIORITY } from '../types';

export const skill_tangya_shengming: SkillRegistration = {
  id: 'bsr_tangya.ult',
  name: '蓝银皇·生命赐福',
  description: '主动发动，选1名友军，使其下一个行动轮可以行动2次',
  isActive: true,
  targetSelector: { kind: 'single_any_character' },
  maxCasts: 1,
  precheck: (self, engine) => {
    const allies = engine.getAlliesOf(self).filter((u) => u.isAlive);
    if (allies.length === 0) return { ok: false, reason: '无存活友军' };
    return { ok: true, candidateIds: allies.map((u) => u.id) };
  },
  activeCast: (self, targetIds, engine) => {
    if (targetIds.length !== 1) return { consumed: false };
    const target = engine.getUnit(targetIds[0]);
    if (!target || target.owner !== self.owner) return { consumed: false };
    const mod: Modifier = {
      id: `tangya_extra_${target.id}_${engine.getRound()}`,
      sourceSkillId: 'bsr_tangya.ult',
      sourceUnitId: self.id,
      category: 'temporal',
      targetUnitId: target.id,
      kind: 'extra_action',
      payload: { count: 1 },
      duration: { type: 'next_turn', turnOwnerId: target.id },
      priority: PRIORITY.TEMPORAL,
    };
    engine.attachModifier(mod);
    engine.emit(
      'skill_active_cast',
      { skillId: 'bsr_tangya.ult' },
      `「蓝银皇·生命赐福」发动，${target.name} 下回合可行动 2 次`,
      { actorId: self.id, targetIds: [target.id], skillId: 'bsr_tangya.ult', severity: 'climax' },
    );
    return { consumed: true };
  },
  hooks: {},
};
