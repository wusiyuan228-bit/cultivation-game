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
 *       仅 attackKind='basic' 且 viaUltimate=false 时生效
 *       "玩家关闭开关"的逻辑：在 store 层通过 unit.qingZhuDisabled 标志位控制
 *       （Store 查到该标志为 true 时，在 collectHooks 阶段跳过本 hook）
 *
 *   🔧 2026-05-16：补 viaUltimate 过滤分支。原本依赖 store 层把 attackKind
 *      改成 'skill_damage' 来排除 followUp 攻击，但这会误屏蔽 defender 侧的
 *      basic-only 被动（小舞儿无敌金身等）。现在 store 层 attackKind 始终为
 *      'basic'，必须本 hook 自己用 viaUltimate 跳过 followUp 攻击。
 */
import type { SkillRegistration, HookHandler } from '../types';

export const skill_hanli_qingzhu: SkillRegistration = {
  id: 'hero_hanli.battle',
  name: '青竹蜂云剑·七十二路',
  description: '进攻时，可以用"修为+心境"总和颗骰子进行判定（仅普通攻击，玩家可在面板关闭）',
  hooks: {
    on_before_roll: ((ctx, engine) => {
      if (ctx.attackKind !== 'basic') return; // Q13: 直伤型不生效
      if (ctx.viaUltimate) return;            // 🔧 2026-05-16 绝技 followUp 攻击不生效（青竹蜂云剑·七十二路是普攻被动）
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
