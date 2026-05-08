/**
 * 【霍雨浩 / 精神风暴】通用SSR · 绝技
 * 策划原文：主动发动，场上所有角色（含己方）原地停留一个行动轮，无法移动
 */
import type { Modifier, SkillRegistration } from '../types';
import { PRIORITY } from '../types';

export const skill_huoyuhao_jingshen: SkillRegistration = {
  id: 'ssr_huoyuhao.ult',
  name: '精神风暴',
  description: '主动发动，场上所有角色（含己方）原地停留一个行动轮，无法移动',
  isActive: true,
  targetSelector: { kind: 'none' },
  maxCasts: 1,
  precheck: () => ({ ok: true }),
  activeCast: (self, _targetIds, engine) => {
    const all = engine.getAllUnits().filter((u) => u.isAlive);
    engine.emit(
      'skill_active_cast',
      { skillId: 'ssr_huoyuhao.ult', count: all.length },
      `「精神风暴」发动：全场停滞`,
      { actorId: self.id, skillId: 'ssr_huoyuhao.ult', severity: 'climax' },
    );
    for (const u of all) {
      const mod: Modifier = {
        id: `jingshen_${u.id}_${engine.getRound()}`,
        sourceSkillId: 'ssr_huoyuhao.ult',
        sourceUnitId: self.id,
        category: 'temporal',
        targetUnitId: u.id,
        kind: 'disable_move',
        payload: {},
        duration: { type: 'next_turn', turnOwnerId: u.id },
        priority: PRIORITY.TEMPORAL,
      };
      engine.attachModifier(mod);
    }
    return { consumed: true };
  },
  hooks: {},
};
