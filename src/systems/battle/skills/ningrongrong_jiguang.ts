/**
 * 【凝蓉蓉 / 九宝琉璃·极光】通用SR · SR绝技
 * 原文：主动发动，选1名友军，永久将其气血上限改为9并回满（超过9的原上限保持不变）
 * trigger: active_once  effect: set_hp_cap
 */
import type { SkillRegistration, BattleUnit, IBattleEngine } from '../types';

export const skill_ningrongrong_jiguang: SkillRegistration = {
  id: 'sr_ningrongrong.ultimate',
  name: '九宝琉璃·极光',
  description: '选 1 名友军，永久将其 hpCap 改为 9 并回满（若原 hpCap ≥ 9 则仅回满）',
  isActive: true,
  maxCasts: 1,
  targetSelector: { kind: 'single_any_ally' },
  precheck: (self: BattleUnit, engine: IBattleEngine) => {
    if (!self.isAlive) return { ok: false, reason: '施法者已退场' };
    const allies = [self, ...engine.getAlliesOf(self)].filter((u) => u.isAlive);
    return allies.length > 0
      ? { ok: true, candidateIds: allies.map((u) => u.id) }
      : { ok: false, reason: '无可选友军' };
  },
  activeCast: (self: BattleUnit, targetIds: string[], engine: IBattleEngine) => {
    const target = engine.getUnit(targetIds[0]);
    if (!target) return { consumed: false };

    const oldCap = target.hpCap;
    if (oldCap < 9) {
      target.hpCap = 9;
      engine.emit(
        'stat_change',
        { unitId: target.id, stat: 'hpCap', setTo: 9 },
        `九宝琉璃·极光：${target.name} hpCap ${oldCap} → 9`,
        { actorId: self.id, targetIds: [target.id], skillId: 'sr_ningrongrong.ultimate', severity: 'climax' },
      );
    } else {
      engine.emit(
        'skill_effect_blocked',
        { skillId: 'sr_ningrongrong.ultimate' },
        `九宝琉璃·极光：${target.name} 原 hpCap ${oldCap} ≥ 9，仅回满气血`,
        { actorId: self.id, targetIds: [target.id], skillId: 'sr_ningrongrong.ultimate', severity: 'info' },
      );
    }
    // Q55 回满（不破上限）
    const delta = target.hpCap - target.hp.current;
    if (delta > 0) {
      engine.changeStat(target.id, 'hp', delta, {
        permanent: false,
        breakCap: false,
        reason: '九宝琉璃·极光 回满',
        skillId: 'sr_ningrongrong.ultimate',
      });
    }
    return { consumed: true };
  },
  hooks: {},
};
