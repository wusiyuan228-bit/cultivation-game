/**
 * 【萧焱 / 佛怒火莲】主角本体 · 绝技
 *
 * 契约登记：
 *   策划原文：主动发动，对相邻所有敌人各进行1次攻击
 *   trigger  : active_once → 展开 N 次 on_after_hit
 *   Q3 裁决  : 每段独立滚骰+独立结算
 *   Q5 裁决  : 相邻无敌人时按钮置灰，不消耗次数
 */
import type { SkillRegistration, TargetSelector, BattleUnit } from '../types';

function adjacentEnemies(self: BattleUnit, engine: any): BattleUnit[] {
  return engine
    .getEnemiesOf(self)
    .filter((e: BattleUnit) => Math.abs(e.row - self.row) + Math.abs(e.col - self.col) === 1);
}

export const skill_xiaoyan_fonu: SkillRegistration = {
  id: 'hero_xiaoyan.ultimate',
  name: '佛怒火莲',
  description: '主动发动，对相邻所有敌人各进行1次攻击',
  isActive: true,
  targetSelector: { kind: 'all_adjacent_enemies' } satisfies TargetSelector,
  maxCasts: 1,
  hooks: {},
  precheck: (self, engine) => {
    if (self.ultimateUsed) return { ok: false, reason: '绝技已使用' };
    const targets = adjacentEnemies(self, engine);
    if (targets.length === 0) {
      return { ok: false, reason: '佛怒火莲发动失败——相邻无敌方单位' };
    }
    return { ok: true, candidateIds: targets.map((u) => u.id) };
  },
  activeCast: (self, _targetIds, engine) => {
    const targets = adjacentEnemies(self, engine);
    if (targets.length === 0) return { consumed: false };
    engine.emit(
      'skill_active_cast',
      { skillId: 'hero_xiaoyan.ultimate', targetIds: targets.map((t) => t.id) },
      `🔥 ${self.name} 发动【佛怒火莲】→ 对相邻 ${targets.length} 名敌人各攻击 1 次`,
      {
        actorId: self.id,
        targetIds: targets.map((t) => t.id),
        skillId: 'hero_xiaoyan.ultimate',
        severity: 'climax',
      },
    );
    self.ultimateUsed = true;
    return { consumed: true };
  },
  followUpAttack: { target: 'targetIds', perTarget: true },
};
