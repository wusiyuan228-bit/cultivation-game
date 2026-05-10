/**
 * 【凝蓉蓉 / 七宝琉璃·加持】通用SR · 战斗技能
 * 原文：行动轮开始时，可指定1名己方角色某项数值（修为/心境/气血）永久+1（受上限约束）
 * trigger: on_turn_start  effect: buff_any_stat  MVP：自动给全场 atk 最低友军+1（atk）
 */
import type { SkillRegistration, TurnHookHandler } from '../types';

export const skill_ningrongrong_qibao: SkillRegistration = {
  id: 'sr_ningrongrong.battle',
  name: '七宝琉璃·加持',
  description: '行动轮开始时，可指定 1 名己方某项数值永久 +1（受上限约束）',
  hooks: {
    on_turn_start: ((ctx, engine) => {
      const self = ctx.unit;
      if (!self.isAlive || !self.skills.includes('sr_ningrongrong.battle')) return;
      // MVP 自动：优先强化 atk 最低的未满上限友军 +1 atk
      const allies = engine.getAlliesOf(self).filter((u) => u.isAlive);
      const target = allies
        .filter((u) => u.atk.current < 9)
        .sort((a, b) => a.atk.current - b.atk.current)[0];
      if (!target) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'sr_ningrongrong.battle' },
          `七宝琉璃·加持待命——所有己方 atk 已达上限`,
          { actorId: self.id, skillId: 'sr_ningrongrong.battle', severity: 'info' },
        );
        return;
      }
      engine.emit(
        'skill_passive_trigger',
        { skillId: 'sr_ningrongrong.battle' },
        `七宝琉璃·加持：${target.name} atk+1（永久）（自动选择 · atk最低的未满上限友军）`,
        { actorId: self.id, targetIds: [target.id], skillId: 'sr_ningrongrong.battle', severity: 'highlight' },
      );
      engine.changeStat(target.id, 'atk', 1, {
        permanent: true,
        breakCap: false,
        reason: '七宝琉璃·加持',
        skillId: 'sr_ningrongrong.battle',
      });
    }) as TurnHookHandler,
  },
};
