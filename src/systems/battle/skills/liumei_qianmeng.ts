/**
 * 【留眉 / 道破情牵】通用SR · SR绝技
 * 原文：主动发动，留眉退场，可指定 1 名已退场的友军回到手牌（主角卡除外）
 * Q68：与 S8 PvP 牌池规则对齐（MVP 仅 emit）
 */
import type { SkillRegistration, BattleUnit, IBattleEngine } from '../types';
import { isHeroUnitId } from './_heroIdHelper';

export const skill_liumei_qianmeng: SkillRegistration = {
  id: 'sr_liumei.ultimate',
  name: '道破情牵',
  description: '留眉退场，选择 1 名已退场友军回到可用池',
  isActive: true,
  maxCasts: 1,
  targetSelector: { kind: 'single_any_ally' },
  precheck: (self: BattleUnit, engine: IBattleEngine) => {
    const deads = engine
      .getAllUnits()
      .filter((u) => !u.isAlive && u.owner === self.owner && !isHeroUnitId(u.id));
    return deads.length > 0
      ? { ok: true, candidateIds: deads.map((u) => u.id) }
      : { ok: false, reason: '无可选已退场友军' };
  },
  activeCast: (self: BattleUnit, targetIds: string[], engine: IBattleEngine) => {
    const target = engine.getUnit(targetIds[0]);
    if (!target) return { consumed: false };
    // 留眉献祭退场
    engine.emit(
      'unit_leave',
      { reason: 'sacrifice', skillId: 'sr_liumei.ultimate' },
      `道破情牵：留眉献祭退场`,
      { actorId: self.id, skillId: 'sr_liumei.ultimate', severity: 'climax' },
    );
    self.isAlive = false;
    // 目标回到可用池（store 层处理）
    engine.emit(
      'skill_effect_applied',
      { skillId: 'sr_liumei.ultimate', targetId: target.id, kind: 'return_to_hand' },
      `${target.name} 回到可用池（待重新入场）`,
      { actorId: self.id, targetIds: [target.id], skillId: 'sr_liumei.ultimate', severity: 'highlight' },
    );
    return { consumed: true };
  },
  hooks: {},
};
