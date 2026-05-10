/**
 * 【小忆仙 / 厄难毒体·全境释放】绑定SR · 绝技
 *
 * 策划原文：主动发动，本大回合剩余时间内，场上所有敌人修为-1（最低为0）
 *
 * 契约登记：
 *   trigger  : active_once
 *   effect   : global_debuff（stat_delta atk -1, duration=round_remain, floor=0）
 */
import type { Modifier, SkillRegistration } from '../types';
import { PRIORITY } from '../types';

export const skill_xiaoyixian_quanjing: SkillRegistration = {
  id: 'bsr_xiaoyixian.ult',
  name: '厄难毒体·全境释放',
  description: '主动发动，本大回合剩余时间内，场上所有敌人修为-1（最低为0）',
  isActive: true,
  targetSelector: { kind: 'none' },
  maxCasts: 1,
  precheck: () => ({ ok: true }),
  activeCast: (self, _targetIds, engine) => {
    const enemies = engine.getEnemiesOf(self).filter((u) => u.isAlive);
    engine.emit(
      'skill_active_cast',
      { skillId: 'bsr_xiaoyixian.ult', count: enemies.length },
      `「厄难毒体·全境释放」发动：全体敌方修为 -1`,
      { actorId: self.id, skillId: 'bsr_xiaoyixian.ult', severity: 'climax' },
    );
    for (const e of enemies) {
      if (e.atk.current <= 0) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'bsr_xiaoyixian.ult', reason: 'already_zero' },
          `${e.name} 修为已为 0，厄难毒体对其无效`,
          { actorId: self.id, targetIds: [e.id], skillId: 'bsr_xiaoyixian.ult', severity: 'info' },
        );
        continue;
      }
      const mod: Modifier = {
        id: `xiaoyixian_ult_${e.id}_${engine.getRound()}`,
        sourceSkillId: 'bsr_xiaoyixian.ult',
        sourceUnitId: self.id,
        category: 'temporal',
        targetUnitId: e.id,
        kind: 'stat_delta',
        payload: { stat: 'atk', delta: -1, floor: 0 },
        duration: { type: 'round_remain' },
        priority: PRIORITY.TEMPORAL,
      };
      engine.attachModifier(mod);
      engine.emit(
        'modifier_applied',
        { skillId: 'bsr_xiaoyixian.ult' },
        `${e.name} 修为 -1（本大回合）`,
        { actorId: self.id, targetIds: [e.id], skillId: 'bsr_xiaoyixian.ult', severity: 'info' },
      );
    }
    return { consumed: true };
  },
  hooks: {},
};
