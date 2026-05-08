/**
 * 【献祭·小舞儿 / 十万年魂骨献祭】主角觉醒 · 绝技
 *
 * 契约登记：
 *   策划原文：主动/被动退场时，塘散所有属性永久+5（可突破上限）
 *   trigger  : on_self_leave（主动+被动均触发）
 *   effect   : buff_target
 *   Q19 裁决：对本体与觉醒形态都生效（instanceId 绑定）
 *
 * 实装：
 *   - 钩子 on_self_leave 触发时，查找场上的"塘散"（按 heroId 反查，兼容本体/觉醒形态）
 *   - 若塘散还在场，hp/atk/mnd 各永久+5，突破上限
 *   - 若塘散已退场，战报披露"未落地"
 *
 * 注意：因为觉醒后才挂载此技能，所以 on_self_leave 钩子接收到的是"觉醒态"的小舞儿退场，
 *       这正确匹配了策划"献祭形态退场时塘散+5"的设计。
 */
import type { SkillRegistration, HookHandler } from '../types';
import { getHeroIdFromUnit } from '@/data/awakeningTriggers';

export const skill_xiaowu_aw_sacrifice: SkillRegistration = {
  id: 'hero_xiaowu.awaken.ultimate',
  name: '十万年魂骨献祭',
  description: '主动/被动退场时，塘散所有属性永久+5（可突破上限）',
  hooks: {
    on_self_leave: ((ctx, engine) => {
      const self = ctx.attacker; // on_self_leave 的 ctx.attacker 是退场的自己
      // 兼容性：某些调用点 ctx.defender 才是退场方，这里双路查找
      const leaving = self; // 统一
      engine.emit(
        'skill_passive_trigger',
        { skillId: 'hero_xiaowu.awaken.ultimate' },
        `💀 ${leaving.name} 退场 →「十万年魂骨献祭」发动`,
        { actorId: leaving.id, skillId: 'hero_xiaowu.awaken.ultimate', severity: 'climax' },
      );

      // 查场上的塘散（按 heroId 反查，本体/觉醒形态皆可）
      const tangsan = engine.getAllUnits().find(
        (u) => getHeroIdFromUnit(u) === 'hero_tangsan' && u.isAlive,
      );
      if (!tangsan) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'hero_xiaowu.awaken.ultimate', reason: 'tangsan_not_on_field' },
          `十万年魂骨献祭发动但塘散已不在场，buff未落地`,
          { skillId: 'hero_xiaowu.awaken.ultimate', severity: 'highlight' },
        );
        return;
      }

      for (const stat of ['hp', 'atk', 'mnd'] as const) {
        engine.changeStat(tangsan.id, stat, 5, {
          permanent: true,
          breakCap: true,
          reason: '十万年魂骨献祭',
          skillId: 'hero_xiaowu.awaken.ultimate',
        });
      }
    }) as HookHandler,
  },
};
