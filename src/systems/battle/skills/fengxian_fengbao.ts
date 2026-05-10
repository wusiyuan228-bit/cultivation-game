/**
 * 【风娴 / 天罡风暴】通用SR · SR绝技
 * 原文：主动发动，将 1 名 3 格内的敌人强制拉到自身相邻格，并进行 1 次攻击
 * Q18 强拉不受 disable_move 阻断；落点必须合法
 * MVP：store 层负责位移 + 发起攻击
 */
import type { SkillRegistration, BattleUnit, IBattleEngine } from '../types';

export const skill_fengxian_fengbao: SkillRegistration = {
  id: 'sr_fengxian.ultimate',
  name: '天罡风暴',
  description: '将 3 格内 1 名敌人强拉到自身相邻格并攻击',
  isActive: true,
  maxCasts: 1,
  targetSelector: { kind: 'single_any_enemy' },
  precheck: (self: BattleUnit, engine: IBattleEngine) => {
    const inRange = engine
      .getEnemiesOf(self)
      .filter((e) => e.isAlive && Math.abs(e.row - self.row) + Math.abs(e.col - self.col) <= 3);
    return inRange.length > 0
      ? { ok: true, candidateIds: inRange.map((u) => u.id) }
      : { ok: false, reason: '3格内无敌方' };
  },
  activeCast: (self: BattleUnit, targetIds: string[], engine: IBattleEngine) => {
    const target = engine.getUnit(targetIds[0]);
    if (!target) return { consumed: false };
    engine.emit(
      'skill_active_cast',
      { skillId: 'sr_fengxian.ultimate', targets: [target.id] },
      `天罡风暴：${target.name} 被强拉至 ${self.name} 身侧并承受攻击`,
      { actorId: self.id, targetIds: [target.id], skillId: 'sr_fengxian.ultimate', severity: 'climax' },
    );
    return { consumed: true };
  },
  hooks: {},
};
