/**
 * 【药尘 / 骨灵冷火·炼】绑定SSR · 战斗技能
 *
 * 策划原文：行动轮结束时，自动恢复相邻1名友军2点气血（不可超过气血上限）
 *
 * 契约登记：
 *   trigger  : on_turn_end
 *   effect   : heal
 *   裁决 Q28 ：候选≥2 时人类弹窗手选，AI 按默认规则（选 hp 最低者，platinum tiebreaker=instanceId）
 *
 * 实装说明：
 *   - 候选过滤：曼哈顿距离 ≤1 的友军，且 hp.current < hpCap
 *   - UI 选择弹窗由 store 层接入（此处 handler 仅执行引擎层 pick）
 *   - MVP：直接按 hp 最低者自动选择（人类玩家弹窗由 UI 层未来补接入）
 */
import type { SkillRegistration, TurnHookHandler } from '../types';

export const skill_yaochen_lenghuo: SkillRegistration = {
  id: 'bssr_yaochen.battle',
  name: '骨灵冷火·炼',
  description: '行动轮结束时，自动恢复相邻1名友军2点气血（不可超过气血上限）',
  hooks: {
    on_turn_end: ((tctx, engine) => {
      const self = engine.getUnit(tctx.unit.id);
      if (!self || !self.isAlive) return;

      // 候选：相邻（曼哈顿 ≤1）且未满血的友军
      const allies = engine.getAlliesOf(self).filter(
        (u) =>
          u.id !== self.id &&
          u.isAlive &&
          Math.abs(u.row - self.row) + Math.abs(u.col - self.col) <= 1 &&
          u.hp.current < u.hpCap,
      );

      if (allies.length === 0) {
        // 需区分 "无相邻友军" 与 "相邻友军均满血"
        const adjacentAllies = engine.getAlliesOf(self).filter(
          (u) =>
            u.id !== self.id &&
            u.isAlive &&
            Math.abs(u.row - self.row) + Math.abs(u.col - self.col) <= 1,
        );
        const reason = adjacentAllies.length === 0 ? 'no_adjacent_ally' : 'all_full_hp';
        const text =
          reason === 'no_adjacent_ally'
            ? `「骨灵冷火·炼」未触发——无相邻友军`
            : `「骨灵冷火·炼」待命——相邻友军均已满血`;
        engine.emit('skill_effect_blocked', { skillId: 'bssr_yaochen.battle', reason }, text, {
          actorId: self.id,
          skillId: 'bssr_yaochen.battle',
          severity: 'info',
        });
        return;
      }

      // Q28 默认策略：选 hp.current 最低者；平手按 id 排序
      allies.sort((a, b) => a.hp.current - b.hp.current || a.id.localeCompare(b.id));
      const target = allies[0];

      engine.emit(
        'skill_passive_trigger',
        { skillId: 'bssr_yaochen.battle' },
        `「骨灵冷火·炼」触发，治疗 ${target.name} 2 点气血（自动选择 · hp最低的相邻友军）`,
        { actorId: self.id, targetIds: [target.id], skillId: 'bssr_yaochen.battle', severity: 'info' },
      );
      engine.changeStat(target.id, 'hp', +2, {
        permanent: false, // 治疗不属于永久加成
        breakCap: false,
        reason: '骨灵冷火·炼',
        skillId: 'bssr_yaochen.battle',
      });
      engine.emit(
        'skill_effect_applied',
        { skillId: 'bssr_yaochen.battle' },
        `${target.name} 恢复气血`,
        { actorId: self.id, targetIds: [target.id], skillId: 'bssr_yaochen.battle', severity: 'info' },
      );
    }) as TurnHookHandler,
  },
};
