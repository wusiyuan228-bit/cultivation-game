/**
 * 【马红俊 / 凤凰火雨】通用SR · SR绝技
 * 原文：主动发动，对相邻所有敌人各进行1次攻击（与佛怒火莲同构）
 */
import type { SkillRegistration, BattleUnit, IBattleEngine } from '../types';

export const skill_mahongjun_huoyu: SkillRegistration = {
  id: 'sr_mahongjun.ultimate',
  name: '凤凰火雨',
  description: '对相邻所有敌人各进行 1 次攻击',
  isActive: true,
  maxCasts: 1,
  targetSelector: { kind: 'all_adjacent_enemies' },
  precheck: (self: BattleUnit, engine: IBattleEngine) => {
    const adj = engine
      .getEnemiesOf(self)
      .filter((e) => e.isAlive && Math.abs(e.row - self.row) + Math.abs(e.col - self.col) === 1);
    return adj.length > 0
      ? { ok: true, candidateIds: adj.map((u) => u.id) }
      : { ok: false, reason: '相邻无敌方' };
  },
  activeCast: (self: BattleUnit, _tids: string[], engine: IBattleEngine) => {
    const adj = engine
      .getEnemiesOf(self)
      .filter((e) => e.isAlive && Math.abs(e.row - self.row) + Math.abs(e.col - self.col) === 1);
    if (adj.length === 0) return { consumed: false };
    engine.emit(
      'skill_active_cast',
      { skillId: 'sr_mahongjun.ultimate', segments: adj.length },
      `凤凰火雨：对 ${adj.length} 名相邻敌人各发起 1 次攻击`,
      { actorId: self.id, targetIds: adj.map((u) => u.id), skillId: 'sr_mahongjun.ultimate', severity: 'climax' },
    );
    // store 层会按 segments 循环发起 resolveAttack（MVP：这里仅记录意图）
    return { consumed: true };
  },
  hooks: {},
};
