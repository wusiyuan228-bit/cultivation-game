/**
 * 【慕沛灵 / 灵药·续命丹】通用SR · SR绝技
 * 原文：主动发动，选 1 名已退场友军，以 3 点气血重新入场（本场限1次，主角除外）
 * Q64：按入场时初始值恢复
 * MVP：engine 层仅做 emit 占位，真实复活由 store 层 handleRevive 执行
 */
import type { SkillRegistration, BattleUnit, IBattleEngine } from '../types';

export const skill_mupeiling_xuming: SkillRegistration = {
  id: 'sr_mupeiling.ultimate',
  name: '灵药·续命丹',
  description: '复活 1 名已退场友军，以 3 点气血重入场（主角除外，本场 1 次）',
  isActive: true,
  maxCasts: 1,
  targetSelector: { kind: 'all_allies_incl_self' }, // UI 这里要过滤"已退场的非主角"
  precheck: (self: BattleUnit, engine: IBattleEngine) => {
    const deads = engine
      .getAllUnits()
      .filter((u) => !u.isAlive && u.owner === self.owner && !u.id.includes('hero_'));
    return deads.length > 0
      ? { ok: true, candidateIds: deads.map((u) => u.id) }
      : { ok: false, reason: '无可复活目标（除主角外）' };
  },
  activeCast: (self: BattleUnit, targetIds: string[], engine: IBattleEngine) => {
    const target = engine.getUnit(targetIds[0]);
    if (!target) return { consumed: false };
    engine.emit(
      'revive',
      { skillId: 'sr_mupeiling.ultimate', targetId: target.id, hp: 3 },
      `灵药·续命丹：${target.name} 以 3 点气血重新入场`,
      { actorId: self.id, targetIds: [target.id], skillId: 'sr_mupeiling.ultimate', severity: 'climax' },
    );
    return { consumed: true };
  },
  hooks: {},
};
