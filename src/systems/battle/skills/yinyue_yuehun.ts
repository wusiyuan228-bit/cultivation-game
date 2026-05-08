/**
 * 【银月 / 月魂献祭】绑定SR · 绝技
 *
 * 策划原文：银月退场时（主动/被动），寒立永久修为+2、气血+2（可突破上限）
 *
 * 契约登记：
 *   trigger  : on_self_leave
 *   effect   : buff_target（hero_hanli 及其觉醒形态通吃 · Q19）
 */
import type { SkillRegistration, HookHandler } from '../types';

export const skill_yinyue_yuehun: SkillRegistration = {
  id: 'bsr_yinyue.ult',
  name: '月魂献祭',
  description: '银月退场时（主动/被动），寒立永久修为+2、气血+2（可突破上限）',
  hooks: {
    on_self_leave: ((ctx, engine) => {
      const self = engine.getUnit(ctx.defender.id);
      if (!self) return;
      // 找寒立（Q19：本体与觉醒通吃，按 name 含"寒立"或 id 含 "hanli"）
      const hanli = engine
        .getAllUnits()
        .find(
          (u) =>
            u.isAlive &&
            u.owner === self.owner &&
            (u.id.includes('hanli') || u.name.includes('寒立')),
        );
      if (!hanli) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'bsr_yinyue.ult', reason: 'no_hanli' },
          `「月魂献祭」未生效——寒立不在场`,
          { actorId: self.id, skillId: 'bsr_yinyue.ult', severity: 'info' },
        );
        return;
      }
      engine.emit(
        'skill_passive_trigger',
        { skillId: 'bsr_yinyue.ult' },
        `「月魂献祭」触发，${hanli.name} 修为 +2、气血 +2`,
        { actorId: self.id, targetIds: [hanli.id], skillId: 'bsr_yinyue.ult', severity: 'climax' },
      );
      engine.changeStat(hanli.id, 'atk', +2, {
        permanent: true,
        breakCap: true,
        reason: '月魂献祭',
        skillId: 'bsr_yinyue.ult',
      });
      engine.changeStat(hanli.id, 'hp', +2, {
        permanent: true,
        breakCap: true,
        reason: '月魂献祭',
        skillId: 'bsr_yinyue.ult',
      });
    }) as HookHandler,
  },
};
