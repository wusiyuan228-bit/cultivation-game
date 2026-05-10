/**
 * 【暮佩翎 / 灵药妙手】通用SR · 战斗技能
 * 原文：行动轮结束时，恢复相邻 1 名气血最低的友军 2 点气血（不可超上限）
 * Q63：按绝对当前 hp 最低；平手时取第一个
 */
import type { SkillRegistration, TurnHookHandler } from '../types';

export const skill_mupeiling_miaoshou: SkillRegistration = {
  id: 'sr_mupeiling.battle',
  name: '灵药妙手',
  description: '行动轮结束时，恢复相邻气血最低友军 2 点气血',
  hooks: {
    on_turn_end: ((ctx, engine) => {
      const self = ctx.unit;
      if (!self.isAlive || !self.skills.includes('sr_mupeiling.battle')) return;
      const adj = engine
        .getAlliesOf(self)
        .filter(
          (u) =>
            u.isAlive &&
            u.id !== self.id &&
            u.hp.current < u.hpCap &&
            Math.abs(u.row - self.row) + Math.abs(u.col - self.col) === 1,
        );
      if (adj.length === 0) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'sr_mupeiling.battle' },
          `灵药妙手：相邻无可治疗友军`,
          { actorId: self.id, skillId: 'sr_mupeiling.battle', severity: 'info' },
        );
        return;
      }
      const target = adj.sort((a, b) => a.hp.current - b.hp.current)[0];
      engine.emit(
        'skill_passive_trigger',
        { skillId: 'sr_mupeiling.battle' },
        `灵药妙手：为 ${target.name} 回复 2 点气血`,
        { actorId: self.id, targetIds: [target.id], skillId: 'sr_mupeiling.battle', severity: 'highlight' },
      );
      engine.changeStat(target.id, 'hp', 2, {
        permanent: false,
        breakCap: false,
        reason: '灵药妙手',
        skillId: 'sr_mupeiling.battle',
      });
    }) as TurnHookHandler,
  },
};
