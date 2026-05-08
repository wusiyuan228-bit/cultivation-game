/**
 * 【雅妃 / 迦南秘藏·全面支援】通用SR · SR绝技
 * 原文：主动发动，治疗所有友军各 2 点气血（含自己，不可超上限）
 */
import type { SkillRegistration, BattleUnit, IBattleEngine } from '../types';

export const skill_yafei_mizang: SkillRegistration = {
  id: 'sr_yafei.ultimate',
  name: '迦南秘藏·全面支援',
  description: '主动发动，治疗所有友军各 2 点气血（含自己，不可超上限）',
  isActive: true,
  maxCasts: 1,
  targetSelector: { kind: 'none' },
  precheck: (self: BattleUnit, engine: IBattleEngine) => {
    const any = engine
      .getAlliesOf(self)
      .some((u) => u.isAlive && u.hp.current < u.hpCap);
    return any || (self.isAlive && self.hp.current < self.hpCap)
      ? { ok: true }
      : { ok: false, reason: '全员满血' };
  },
  activeCast: (self: BattleUnit, _tids: string[], engine: IBattleEngine) => {
    const allies = engine.getAlliesOf(self).filter((u) => u.isAlive);
    engine.emit(
      'skill_active_cast',
      { skillId: 'sr_yafei.ultimate', targets: allies.map((u) => u.id) },
      `迦南秘藏·全面支援：治疗全体友军各 2 点气血`,
      { actorId: self.id, targetIds: allies.map((u) => u.id), skillId: 'sr_yafei.ultimate', severity: 'climax' },
    );
    allies.forEach((a) => {
      if (a.hp.current < a.hpCap) {
        engine.changeStat(a.id, 'hp', 2, {
          permanent: false,
          breakCap: false,
          reason: '迦南秘藏·全面支援',
          skillId: 'sr_yafei.ultimate',
        });
      }
    });
    return { consumed: true };
  },
  hooks: {},
};
