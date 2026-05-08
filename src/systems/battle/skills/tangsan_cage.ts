/**
 * 【塘散 / 蓝银囚笼】主角本体 · 战斗技能（新引擎接入）
 *
 * 契约登记：
 *   策划原文：进攻时，目标的下一个行动轮无法移动
 *   trigger  : on_after_hit（命中后）
 *   effect   : disable_move (next_turn)
 *
 * 实装（P5 阶段正式启用）：
 *   - 用 on_after_hit 钩子，在命中后给目标挂 disable_move modifier
 *   - duration = next_turn，由 cleanupOnTurnStart 在目标下一个行动轮开始时消费
 *   - 仅在持有者（塘散）作为攻方时生效：__firingUnitIsAttacker__ 身份守卫
 *
 * 向后兼容：
 *   - S7B 旧路径 (unit.immobileNextTurn + ctx.attacker.skillId==='skill_blueSilverCage')
 *     保留。新引擎侧通过 modifier 走标准路径，二者互斥消费：
 *     store 层在 cleanupOnTurnStart 里同时检查 immobileNextTurn 与 disable_move modifier，
 *     任一存在即标记 immobilized=true。
 */
import type { Modifier, SkillRegistration, HookHandler } from '../types';
import { PRIORITY } from '../types';

export const skill_tangsan_cage: SkillRegistration = {
  id: 'hero_tangsan.battle.cage',
  name: '蓝银囚笼',
  description: '进攻时，目标的下一个行动轮无法移动',
  hooks: {
    on_after_hit: ((ctx, engine) => {
      // 仅当持有者（塘散）是本次攻击的攻方时才生效
      if ((ctx as any).__firingUnitIsAttacker__ !== true) return;

      const attacker = engine.getUnit(ctx.attacker.id);
      const target = engine.getUnit(ctx.defender.id);
      if (!attacker || !target || !target.isAlive) return;

      // 给目标挂 disable_move modifier（next_turn 持续到目标的下一个行动轮）
      const mod: Modifier = {
        id: `tangsan_cage_${target.id}_${engine.getRound()}`,
        sourceSkillId: 'hero_tangsan.battle.cage',
        sourceUnitId: attacker.id,
        category: 'temporal',
        targetUnitId: target.id,
        kind: 'disable_move',
        payload: {},
        duration: { type: 'next_turn', turnOwnerId: target.id },
        priority: PRIORITY.TEMPORAL,
      };
      engine.attachModifier(mod);

      engine.emit(
        'skill_passive_trigger',
        { skillId: 'hero_tangsan.battle.cage' },
        `「蓝银囚笼」触发，${target.name} 下一行动轮无法移动`,
        {
          actorId: attacker.id,
          targetIds: [target.id],
          skillId: 'hero_tangsan.battle.cage',
          severity: 'info',
        },
      );
    }) as HookHandler,
  },
};
