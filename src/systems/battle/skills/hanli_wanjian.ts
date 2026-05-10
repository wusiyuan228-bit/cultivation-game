/**
 * 【寒立 / 万剑归宗】主角本体 · 绝技
 *
 * 契约登记：
 *   策划原文：主动发动，选1名同行或同列的敌人（无需相邻），投修为×2颗骰子进行攻击
 *   trigger  : active_once
 *   Q14 裁决 : ignoreRange=true，无视距离也无视阻挡
 */
import type { SkillRegistration, TargetSelector, BattleUnit } from '../types';

function lineEnemies(self: BattleUnit, engine: any): BattleUnit[] {
  return engine
    .getEnemiesOf(self)
    .filter((e: BattleUnit) => e.row === self.row || e.col === self.col);
}

export const skill_hanli_wanjian: SkillRegistration = {
  id: 'hero_hanli.ultimate',
  name: '万剑归宗',
  description: '主动发动，选1名同行或同列的敌人，投"修为×2"颗骰子进行攻击（无视距离/阻挡）',
  isActive: true,
  targetSelector: { kind: 'single_line_enemy' } satisfies TargetSelector,
  maxCasts: 1,
  hooks: {},
  precheck: (self, engine) => {
    if (self.ultimateUsed) return { ok: false, reason: '绝技已使用' };
    const targets = lineEnemies(self, engine);
    if (targets.length === 0) {
      return { ok: false, reason: '万剑归宗发动失败——同行同列无敌方单位' };
    }
    return { ok: true, candidateIds: targets.map((u) => u.id) };
  },
  activeCast: (self, targetIds, engine) => {
    const targetId = targetIds[0];
    if (!targetId) return { consumed: false };
    const target = engine.getUnit(targetId);
    if (!target) return { consumed: false };
    engine.emit(
      'skill_active_cast',
      { skillId: 'hero_hanli.ultimate', targetId, diceCount: self.atk.current * 2 },
      `🗡 ${self.name} 发动【万剑归宗】→ ${target.name}（投 ${self.atk.current * 2} 骰）`,
      {
        actorId: self.id,
        targetIds: [targetId],
        skillId: 'hero_hanli.ultimate',
        severity: 'climax',
      },
    );
    self.ultimateUsed = true;
    return { consumed: true };
  },
  followUpAttack: {
    target: 'first_only',
    diceOverride: (self) => self.atk.current * 2,
  },
};
