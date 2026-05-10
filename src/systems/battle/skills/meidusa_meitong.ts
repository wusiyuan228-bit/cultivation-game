/**
 * 【玫渡纱 / 蛇后魅瞳】通用SSR · 战斗技能
 * 策划原文：进攻时，可消耗自身1点气血，使目标下一个行动轮无法进攻（仍可移动）
 * MVP：AI 自动发动；人类玩家弹窗由 UI 层后续接入
 */
import type { Modifier, SkillRegistration, HookHandler } from '../types';
import { PRIORITY } from '../types';

export const skill_meidusa_meitong: SkillRegistration = {
  id: 'ssr_meidusa.battle',
  name: '蛇后魅瞳',
  description: '进攻时，可消耗自身1点气血，使目标下一个行动轮无法进攻',
  hooks: {
    on_after_hit: ((ctx, engine) => {
      const self = engine.getUnit(ctx.attacker.id);
      const target = engine.getUnit(ctx.defender.id);
      if (!self || !target) return;
      if (self.hp.current < 2) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'ssr_meidusa.battle', reason: 'hp_too_low' },
          `「蛇后魅瞳」无法启动——气血不足`,
          { actorId: self.id, skillId: 'ssr_meidusa.battle', severity: 'info' },
        );
        return;
      }
      if (!target.isAlive || target.hp.current <= 0) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'ssr_meidusa.battle', reason: 'target_leaving' },
          `「蛇后魅瞳」未生效——${target.name} 已退场`,
          { actorId: self.id, targetIds: [target.id], skillId: 'ssr_meidusa.battle', severity: 'info' },
        );
        return;
      }
      engine.changeStat(self.id, 'hp', -1, {
        permanent: false,
        reason: '蛇后魅瞳消耗',
        skillId: 'ssr_meidusa.battle',
      });
      const mod: Modifier = {
        id: `meitong_${target.id}_${engine.getRound()}`,
        sourceSkillId: 'ssr_meidusa.battle',
        sourceUnitId: self.id,
        category: 'temporal',
        targetUnitId: target.id,
        kind: 'disable_attack',
        payload: {},
        duration: { type: 'next_turn', turnOwnerId: target.id },
        priority: PRIORITY.TEMPORAL,
      };
      engine.attachModifier(mod);
      engine.emit(
        'skill_passive_trigger',
        { skillId: 'ssr_meidusa.battle' },
        `「蛇后魅瞳」触发，${target.name} 下回合无法进攻`,
        { actorId: self.id, targetIds: [target.id], skillId: 'ssr_meidusa.battle', severity: 'highlight' },
      );
    }) as HookHandler,
  },
};
