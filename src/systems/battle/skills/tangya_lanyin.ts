/**
 * 【塘雅 / 蓝银缠绕·愈】绑定SR · 战斗技能
 *
 * 策划原文：行动轮结束时，可指定1名角色气血+1（可突破气血上限）
 *
 * 契约登记：
 *   trigger  : on_turn_end
 *   effect   : buff_hp（+1, breakCap=true）
 *   裁决 Q34 ：仅限友军（战术合理性优先）
 *
 * 实装 MVP：自动选择"hp 最低的友军"（含自己）；UI 弹窗后续接入
 */
import type { SkillRegistration, TurnHookHandler } from '../types';

export const skill_tangya_lanyin: SkillRegistration = {
  id: 'bsr_tangya.battle',
  name: '蓝银缠绕·愈',
  description: '行动轮结束时，可指定1名友军气血+1（可突破气血上限）',
  hooks: {
    on_turn_end: ((tctx, engine) => {
      const self = engine.getUnit(tctx.unit.id);
      if (!self || !self.isAlive) return;
      // Q34：仅友军（含自己）
      const allies = engine.getAlliesOf(self).filter((u) => u.isAlive);
      allies.push(self);
      // 优先治疗 hp 最低且 < hpCap+2（突破上限最多+1）者
      allies.sort((a, b) => a.hp.current - b.hp.current || a.id.localeCompare(b.id));
      const target = allies[0];
      if (!target) return;

      engine.emit(
        'skill_passive_trigger',
        { skillId: 'bsr_tangya.battle' },
        `「蓝银缠绕·愈」触发，为 ${target.name} 补充 1 点气血（自动选择 · hp最低的友军）`,
        { actorId: self.id, targetIds: [target.id], skillId: 'bsr_tangya.battle', severity: 'info' },
      );
      engine.changeStat(target.id, 'hp', +1, {
        permanent: false,
        breakCap: true,
        reason: '蓝银缠绕·愈',
        skillId: 'bsr_tangya.battle',
      });
    }) as TurnHookHandler,
  },
};
