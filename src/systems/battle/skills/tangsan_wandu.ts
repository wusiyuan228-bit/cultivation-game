/**
 * 【塘散 / 暗器·万毒淬体】主角本体 · 绝技
 *
 * 契约登记：
 *   策划原文：主动发动，对十字方向（上下左右各1格）所有敌人各进行1次攻击，
 *             被命中的目标修为永久-1（最低为1）
 *   trigger  : active_once → 展开最多 4 次 on_after_hit 序列
 *   Q3 裁决  : 每段独立滚骰+独立结算
 *   Q4       : 待裁决 —— 目标 atk=1 时是否仍受伤害部分。本实装采用：
 *              默认 atk=1 仍受伤害，只是 atk-1 debuff 不挂载（前置披露）
 *   Q5 裁决  : 前置检查无目标则按钮置灰不消耗次数
 */
import type { SkillRegistration, TargetSelector, BattleUnit } from '../types';

function crossEnemies(self: BattleUnit, engine: any): BattleUnit[] {
  return engine
    .getEnemiesOf(self)
    .filter((e: BattleUnit) => Math.abs(e.row - self.row) + Math.abs(e.col - self.col) === 1);
}

export const skill_tangsan_wandu: SkillRegistration = {
  id: 'hero_tangsan.ultimate',
  name: '暗器·万毒淬体',
  description: '主动发动，对十字方向（上下左右各1格）所有敌人各进行1次攻击，被命中的目标修为永久-1（最低为1）',
  isActive: true,
  targetSelector: { kind: 'cross_adjacent_enemies' } satisfies TargetSelector,
  maxCasts: 1,
  hooks: {},
  precheck: (self, engine) => {
    if (self.ultimateUsed) return { ok: false, reason: '绝技已使用' };
    const targets = crossEnemies(self, engine);
    if (targets.length === 0) {
      return { ok: false, reason: '暗器·万毒淬体发动失败——十字范围内无敌方单位' };
    }
    return { ok: true, candidateIds: targets.map((u) => u.id) };
  },
  activeCast: (self, _targetIds, engine) => {
    const targets = crossEnemies(self, engine);
    if (targets.length === 0) return { consumed: false };
    engine.emit(
      'skill_active_cast',
      { skillId: 'hero_tangsan.ultimate', targetIds: targets.map((t) => t.id) },
      `🗡 ${self.name} 发动【暗器·万毒淬体】→ 对十字相邻 ${targets.length} 名敌人各攻击 1 次`,
      {
        actorId: self.id,
        targetIds: targets.map((t) => t.id),
        skillId: 'hero_tangsan.ultimate',
        severity: 'climax',
      },
    );
    self.ultimateUsed = true;
    // 实际多段 resolveAttack 在 store.performUltimate 中执行
    // 每次命中后对目标 atk -1 永久（在 store 内根据 skillId 识别执行）
    return { consumed: true };
  },
};
