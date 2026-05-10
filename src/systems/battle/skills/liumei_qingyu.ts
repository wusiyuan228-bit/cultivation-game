/**
 * 【留眉 / 万欢情欲道】通用SR · 战斗技能
 * 原文：行动轮结束时，若旺林在场则旺林 hp+2；否则相邻所有友军各 +1
 * Q40：旺林满血不 fallback
 */
import type { SkillRegistration, TurnHookHandler } from '../types';

const WANGLIN_HERO_ID_HINT = 'hero_wanglin';

export const skill_liumei_qingyu: SkillRegistration = {
  id: 'sr_liumei.battle',
  name: '万欢情欲道',
  description: '行动轮结束时，若旺林在场则 +2 给旺林；否则相邻友军各 +1',
  hooks: {
    on_turn_end: ((ctx, engine) => {
      const self = ctx.unit;
      if (!self.isAlive || !self.skills.includes('sr_liumei.battle')) return;
      const wanglin = engine
        .getAlliesOf(self)
        .find((u) => u.isAlive && u.id.includes(WANGLIN_HERO_ID_HINT));
      if (wanglin) {
        if (wanglin.hp.current >= wanglin.hpCap) {
          engine.emit(
            'skill_effect_blocked',
            { skillId: 'sr_liumei.battle' },
            `万欢情欲道未生效——旺林已满血（Q40 不 fallback）`,
            { actorId: self.id, skillId: 'sr_liumei.battle', severity: 'info' },
          );
          return;
        }
        engine.emit(
          'skill_passive_trigger',
          { skillId: 'sr_liumei.battle' },
          `万欢情欲道：旺林 hp+2`,
          { actorId: self.id, targetIds: [wanglin.id], skillId: 'sr_liumei.battle', severity: 'highlight' },
        );
        engine.changeStat(wanglin.id, 'hp', 2, {
          permanent: false,
          breakCap: false,
          reason: '万欢情欲道',
          skillId: 'sr_liumei.battle',
        });
        return;
      }
      const adj = engine
        .getAlliesOf(self)
        .filter(
          (u) =>
            u.isAlive &&
            u.id !== self.id &&
            Math.abs(u.row - self.row) + Math.abs(u.col - self.col) === 1 &&
            u.hp.current < u.hpCap,
        );
      if (adj.length === 0) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'sr_liumei.battle' },
          `万欢情欲道未触发——相邻无可治疗友军`,
          { actorId: self.id, skillId: 'sr_liumei.battle', severity: 'info' },
        );
        return;
      }
      engine.emit(
        'skill_passive_trigger',
        { skillId: 'sr_liumei.battle' },
        `万欢情欲道：相邻 ${adj.length} 名友军各 +1 hp`,
        { actorId: self.id, targetIds: adj.map((u) => u.id), skillId: 'sr_liumei.battle', severity: 'highlight' },
      );
      adj.forEach((a) => {
        engine.changeStat(a.id, 'hp', 1, {
          permanent: false,
          breakCap: false,
          reason: '万欢情欲道 · 散治',
          skillId: 'sr_liumei.battle',
        });
      });
    }) as TurnHookHandler,
  },
};
