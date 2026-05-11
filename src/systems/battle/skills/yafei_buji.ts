/**
 * 【娅妃 / 迦南商会·补给】通用SR · 战斗技能
 * 原文：行动轮开始时，可指定 1 名友军和自己各 +1 气血（不可超上限）
 * 2026-05-11：新增 interactiveOnTurnStart，玩家可手动选友军（自身固定 +1）
 */
import type { SkillRegistration, TurnHookHandler } from '../types';

export const skill_yafei_buji: SkillRegistration = {
  id: 'sr_yafei.battle',
  name: '迦南商会·补给',
  description: '行动轮开始时，自身 +1 hp 并为 1 名友军 +1 hp',
  interactiveOnTurnStart: {
    promptTitle: '迦南商会·补给',
    promptBody: '行动开始前可恢复自身 +1 气血并为 1 名缺血友军 +1 气血。是否发动？',
    collectChoices: (self, engine) => {
      const allies = engine
        .getAlliesOf(self)
        .filter((u) => u.isAlive && u.id !== self.id && u.hp.current < u.hpCap);
      // 即使没有缺血友军，只要自身缺血也允许触发；用占位特殊 targetId 'self' 代表"仅恢复自身"
      const choices: Array<{ targetId: string }> = allies.map((u) => ({ targetId: u.id }));
      if (self.hp.current < self.hpCap) {
        choices.push({ targetId: self.id }); // 选自身=只恢复自己
      }
      return choices;
    },
    apply: (self, target, _stat, engine) => {
      // 自身先 +1（如未满）
      if (self.hp.current < self.hpCap) {
        engine.changeStat(self.id, 'hp', +1, {
          permanent: false,
          breakCap: false,
          reason: '迦南商会·补给',
          skillId: 'sr_yafei.battle',
        });
      }
      // 若选的不是自身，给目标也 +1
      if (target.id !== self.id && target.hp.current < target.hpCap) {
        engine.changeStat(target.id, 'hp', +1, {
          permanent: false,
          breakCap: false,
          reason: '迦南商会·补给',
          skillId: 'sr_yafei.battle',
        });
      }
      engine.emit(
        'skill_passive_trigger',
        { skillId: 'sr_yafei.battle' },
        target.id === self.id
          ? `迦南商会·补给：${self.name} 自身 +1 气血（玩家选择）`
          : `迦南商会·补给：${self.name} 自身 +1 气血，${target.name} +1 气血（玩家选择）`,
        {
          actorId: self.id,
          targetIds: target.id === self.id ? [self.id] : [self.id, target.id],
          skillId: 'sr_yafei.battle',
          severity: 'highlight',
        },
      );
    },
  },
  hooks: {
    on_turn_start: ((ctx, engine) => {
      const self = ctx.unit;
      if (!self.isAlive || !self.skills.includes('sr_yafei.battle')) return;
      const otherAllies = engine.getAlliesOf(self).filter((u) => u.isAlive && u.id !== self.id);
      const missingSelf = self.hp.current < self.hpCap;
      const target = otherAllies
        .filter((u) => u.hp.current < u.hpCap)
        .sort((a, b) => a.hp.current / a.hpCap - b.hp.current / b.hpCap)[0];

      if (!missingSelf && !target) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'sr_yafei.battle' },
          `迦南商会·补给待命——自身及可选友军均已满血`,
          { actorId: self.id, skillId: 'sr_yafei.battle', severity: 'info' },
        );
        return;
      }
      engine.emit(
        'skill_passive_trigger',
        { skillId: 'sr_yafei.battle' },
        `迦南商会·补给 触发`,
        { actorId: self.id, skillId: 'sr_yafei.battle', severity: 'highlight' },
      );
      if (missingSelf) {
        engine.changeStat(self.id, 'hp', 1, {
          permanent: false,
          breakCap: false,
          reason: '迦南商会·补给',
          skillId: 'sr_yafei.battle',
        });
      }
      if (target) {
        engine.changeStat(target.id, 'hp', 1, {
          permanent: false,
          breakCap: false,
          reason: '迦南商会·补给',
          skillId: 'sr_yafei.battle',
        });
      }
    }) as TurnHookHandler,
  },
};
