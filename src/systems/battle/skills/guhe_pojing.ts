/**
 * 【古河 / 丹师秘药·破境丹】通用SR · SR绝技
 * 原文：主动发动，选1名友军，永久 atk+3、hp+3（可突破上限）
 */
import type { SkillRegistration, BattleUnit, IBattleEngine } from '../types';

export const skill_guhe_pojing: SkillRegistration = {
  id: 'sr_guhe.ultimate',
  name: '丹师秘药·破境丹',
  description: '选 1 名友军，永久 atk+3、hp+3（可突破上限）',
  isActive: true,
  maxCasts: 1,
  targetSelector: { kind: 'all_allies_incl_self' },
  precheck: (self: BattleUnit) => ({ ok: self.isAlive }),
  activeCast: (self: BattleUnit, targetIds: string[], engine: IBattleEngine) => {
    const target = engine.getUnit(targetIds[0]);
    if (!target) return { consumed: false };
    engine.emit(
      'skill_active_cast',
      { skillId: 'sr_guhe.ultimate' },
      `破境丹：${target.name} atk+3 hp+3（可破上限）`,
      { actorId: self.id, targetIds: [target.id], skillId: 'sr_guhe.ultimate', severity: 'climax' },
    );
    engine.changeStat(target.id, 'atk', 3, {
      permanent: true,
      breakCap: true,
      reason: '破境丹',
      skillId: 'sr_guhe.ultimate',
    });
    engine.changeStat(target.id, 'hp', 3, {
      permanent: true,
      breakCap: true,
      reason: '破境丹',
      skillId: 'sr_guhe.ultimate',
    });
    return { consumed: true };
  },
  hooks: {},
};
