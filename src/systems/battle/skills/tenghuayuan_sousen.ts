/**
 * 【藤化原 / 天鬼搜身】通用SR · 战斗技能
 * 原文：行动轮开始时，可与任意 1 名角色交换位置
 * Q69：被 disable_move 的角色可被强制交换
 * MVP：自动与最近的敌方单位交换
 */
import type { SkillRegistration, TurnHookHandler } from '../types';

export const skill_tenghuayuan_sousen: SkillRegistration = {
  id: 'sr_tenghuayuan.battle',
  name: '天鬼搜身',
  description: '行动轮开始时，与任意角色交换位置（强制生效）',
  hooks: {
    on_turn_start: ((ctx, engine) => {
      const self = ctx.unit;
      if (!self.isAlive || !self.skills.includes('sr_tenghuayuan.battle')) return;
      // MVP：自动与最近的敌方单位交换
      const target = engine
        .getEnemiesOf(self)
        .filter((u) => u.isAlive)
        .sort(
          (a, b) =>
            Math.abs(a.row - self.row) +
            Math.abs(a.col - self.col) -
            (Math.abs(b.row - self.row) + Math.abs(b.col - self.col)),
        )[0];
      if (!target) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'sr_tenghuayuan.battle' },
          `天鬼搜身本轮未指定目标`,
          { actorId: self.id, skillId: 'sr_tenghuayuan.battle', severity: 'info' },
        );
        return;
      }
      const [srR, srC] = [self.row, self.col];
      self.row = target.row;
      self.col = target.col;
      target.row = srR;
      target.col = srC;
      engine.emit(
        'position_change',
        { swap: true, a: self.id, b: target.id },
        `天鬼搜身：${self.name} ⇄ ${target.name} 位置互换（自动选择 · 最近敌方）`,
        { actorId: self.id, targetIds: [target.id], skillId: 'sr_tenghuayuan.battle', severity: 'highlight' },
      );
    }) as TurnHookHandler,
  },
};
