/**
 * 【小舞儿 / 无敌金身】主角本体 · 战斗技能
 *
 * 契约登记：
 *   策划原文：被攻击时，将本次受到的伤害降为2点
 *   trigger  : on_damage_calc
 *   effect   : reduce_damage_to (cap=2)
 *   Q6 裁决  : scope=`basic_attack_only`，仅覆盖普通攻击伤害；
 *              技能直接伤害 / 反伤 / 自伤不走金身封顶
 *   未生效披露：原本伤害 ≤2 时"待命"；为技能直接伤害时不生效
 *
 * 实装：在 on_damage_calc 末尾，让 defender 侧的 hook 往 calcLog 推一条
 *       特殊 marker（'__cap__'），resolveAttack 识别后对最终伤害做 min(x, 2)
 *       由于小舞儿仅挂在 defender 侧，attackKind='basic' 才生效
 */
import type { SkillRegistration, HookHandler } from '../types';

export const skill_xiaowu_wudi: SkillRegistration = {
  id: 'hero_xiaowu.battle',
  name: '无敌金身',
  description: '被攻击时，将本次受到的伤害降为2点（仅普通攻击伤害）',
  hooks: {
    on_damage_calc: ((ctx, engine) => {
      // BUGFIX（2026-05-01）：s7bBattleStore.fireHooks 对 attacker 和 defender 双方都 fire，
      // 无敌金身只在"本单位身为防守方"时才应生效（纯防御被动）。
      if ((ctx as any).__firingUnitIsAttacker__ === true) return;
      if (ctx.attackKind !== 'basic') {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'hero_xiaowu.battle', reason: 'non_basic_attack' },
          `「无敌金身」未生效——本次为技能直接伤害`,
          { actorId: ctx.defender.id, skillId: 'hero_xiaowu.battle', severity: 'debug' },
        );
        return;
      }
      // push 一条 __cap__ marker，resolveAttack 在 ③阶段后会对最终伤害做 min
      ctx.calcLog.push({
        source: 'hero_xiaowu.battle__cap__',
        delta: 2,
        note: '无敌金身：伤害上限封顶 2',
      });
      engine.emit(
        'skill_passive_trigger',
        { skillId: 'hero_xiaowu.battle', cap: 2 },
        `「无敌金身」生效，本次受到伤害封顶为 2`,
        { actorId: ctx.defender.id, skillId: 'hero_xiaowu.battle', severity: 'highlight' },
      );
    }) as HookHandler,
  },
};
