/**
 * 【古元 / 远古斗帝血脉】绑定SSR · 绝技
 *
 * 策划原文：主动发动，本大回合剩余时间内，所有友军修为+1（可突破修为上限）
 *
 * 契约登记：
 *   trigger  : active_once
 *   effect   : global_buff（stat_delta atk +1, duration=round_remain, breakCap=true）
 */
import type { Modifier, SkillRegistration } from '../types';
import { PRIORITY } from '../types';

export const skill_guyuan_yuangu: SkillRegistration = {
  id: 'bssr_guyuan.ult',
  name: '远古斗帝血脉',
  description: '主动发动，本大回合剩余时间内，所有友军修为+1（可突破修为上限）',
  isActive: true,
  targetSelector: { kind: 'none' },
  maxCasts: 1,
  precheck: () => ({ ok: true }),
  activeCast: (self, _targetIds, engine) => {
    const allies = engine.getAlliesOf(self).filter((u) => u.isAlive);
    engine.emit(
      'skill_active_cast',
      { skillId: 'bssr_guyuan.ult', allyCount: allies.length },
      `「远古斗帝血脉」发动：全体友军修为 +1`,
      { actorId: self.id, skillId: 'bssr_guyuan.ult', severity: 'climax' },
    );
    for (const ally of allies) {
      const mod: Modifier = {
        id: `guyuan_ult_${ally.id}_${engine.getRound()}`,
        sourceSkillId: 'bssr_guyuan.ult',
        sourceUnitId: self.id,
        category: 'temporal',
        targetUnitId: ally.id,
        kind: 'stat_delta',
        payload: { stat: 'atk', delta: +1, breakCap: true },
        duration: { type: 'round_remain' },
        priority: PRIORITY.TEMPORAL,
      };
      engine.attachModifier(mod);
      engine.emit(
        'modifier_applied',
        { skillId: 'bssr_guyuan.ult' },
        `${ally.name} 修为 +1（本大回合）`,
        { actorId: self.id, targetIds: [ally.id], skillId: 'bssr_guyuan.ult', severity: 'info' },
      );
    }
    return { consumed: true };
  },
  hooks: {},
};
