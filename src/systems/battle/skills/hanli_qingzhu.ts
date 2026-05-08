/**
 * 【寒立 / 青竹蜂云剑·七十二路】主角本体 · 战斗技能
 *
 * 契约登记：
 *   策划原文：进攻时，可以用修为和心境总和颗骰子进行判定
 *   trigger  : on_before_roll
 *   effect   : dice_count_override = self.atk + self.mnd
 *   Q12 裁决：技能面板常驻开关，默认 ON，玩家可手动关闭
 *   Q13 裁决：scope = basic_attack only，不作用于绝技
 *
 * 实装：读取 ctx.attacker.mnd.current 并覆盖 ctx.diceAttack = atk + mnd
 *       仅 attackKind='basic' 生效
 *       "玩家关闭开关"的逻辑：在 store 层通过 unit.qingZhuDisabled 标志位控制
 *       （Store 查到该标志为 true 时，在 collectHooks 阶段跳过本 hook）
 */
import type { SkillRegistration, HookHandler } from '../types';

export const skill_hanli_qingzhu: SkillRegistration = {
  id: 'hero_hanli.battle',
  name: '青竹蜂云剑·七十二路',
  description: '进攻时，可以用"修为+心境"总和颗骰子进行判定（仅普通攻击，玩家可在面板关闭）',
  hooks: {
    on_before_roll: ((ctx, engine) => {
      if (ctx.attackKind !== 'basic') return; // Q13: 绝技不生效
      const attacker = ctx.attacker;
      const newDice = attacker.atk.current + attacker.mnd.current;
      if (newDice <= ctx.diceAttack) {
        // 骰数不增，不触发披露（避免无意义刷屏）
        return;
      }
      const delta = newDice - ctx.diceAttack;
      ctx.diceAttack = newDice;
      engine.emit(
        'skill_passive_trigger',
        {
          skillId: 'hero_hanli.battle',
          from: attacker.atk.current,
          to: newDice,
          delta,
        },
        `「青竹蜂云剑·七十二路」生效，骰数由 ${attacker.atk.current} 提升至 ${newDice}（修为+心境）`,
        { actorId: attacker.id, skillId: 'hero_hanli.battle', severity: 'highlight' },
      );
    }) as HookHandler,
  },
};
