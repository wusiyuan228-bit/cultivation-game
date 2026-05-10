/**
 * 【曜尘 / 丹帝遗方】绑定SSR · 绝技
 *
 * 策划原文：主动发动，选1名友军，修为值永久改为10（可突破上限）
 *
 * 契约登记：
 *   trigger  : active_once
 *   effect   : set_stat
 *   裁决 Q29 ：A · 只提不降 —— if (target.atk < 10) target.atk = 10，否则披露 T4 未生效
 */
import type { SkillRegistration } from '../types';

export const skill_yaochen_danyi: SkillRegistration = {
  id: 'bssr_yaochen.ult',
  name: '丹帝遗方',
  description: '主动发动，选1名友军，修为值永久改为10（可突破上限）',
  isActive: true,
  targetSelector: { kind: 'single_any_character' }, // 过滤友军在 activeCast 内
  maxCasts: 1,
  precheck: (self, engine) => {
    const allies = engine.getAlliesOf(self).filter((u) => u.isAlive);
    if (allies.length === 0) return { ok: false, reason: '无存活友军' };
    return { ok: true, candidateIds: allies.map((u) => u.id) };
  },
  activeCast: (self, targetIds, engine) => {
    if (targetIds.length !== 1) return { consumed: false };
    const target = engine.getUnit(targetIds[0]);
    if (!target || target.owner !== self.owner) {
      engine.emit(
        'skill_effect_blocked',
        { skillId: 'bssr_yaochen.ult', reason: 'invalid_target' },
        `「丹帝遗方」发动失败——目标必须为友军`,
        { actorId: self.id, skillId: 'bssr_yaochen.ult', severity: 'info' },
      );
      return { consumed: false };
    }
    engine.emit(
      'skill_active_cast',
      { skillId: 'bssr_yaochen.ult' },
      `「丹帝遗方」发动，目标：${target.name}`,
      { actorId: self.id, targetIds: [target.id], skillId: 'bssr_yaochen.ult', severity: 'climax' },
    );
    // Q29：只提不降
    if (target.atk.current >= 10) {
      engine.emit(
        'skill_effect_blocked',
        { skillId: 'bssr_yaochen.ult', reason: 'already_high' },
        `「丹帝遗方」对 ${target.name} 无变化——当前修为已 ≥10`,
        { actorId: self.id, targetIds: [target.id], skillId: 'bssr_yaochen.ult', severity: 'info' },
      );
      return { consumed: true };
    }
    const delta = 10 - target.atk.current;
    engine.changeStat(target.id, 'atk', delta, {
      permanent: true,
      breakCap: true,
      reason: '丹帝遗方',
      skillId: 'bssr_yaochen.ult',
    });
    engine.emit(
      'skill_effect_applied',
      { skillId: 'bssr_yaochen.ult', newAtk: 10 },
      `${target.name} 修为永久提升至 10`,
      { actorId: self.id, targetIds: [target.id], skillId: 'bssr_yaochen.ult', severity: 'highlight' },
    );
    return { consumed: true };
  },
  hooks: {},
};
