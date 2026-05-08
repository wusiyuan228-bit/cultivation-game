/**
 * 【司徒南 / 天逆珠·修炼】绑定SSR · 战斗技能（主动，无次数）
 *
 * 策划原文：主动发动，可减少自身X点气血（X≤当前气血-1），让另1名友军所有属性各增加X点
 *          （不可超过上限，心境最多+2）
 *
 * 契约登记：
 *   trigger  : active_variable（Q80 裁决：无次数限制，同 turn 可多次）
 *   effect   : self_sacrifice_buff_ally
 *   约束     : X ≤ self.hp.current - 1，X ≥ 1
 *   mnd 上限：本次转化最多 +2（Q80 保留原文）
 *
 * 实装说明（阶段 E1 MVP）：
 *   - 目标选择器：single_any_character（实际按 ally 过滤）
 *   - 由于玩家需输入 X，MVP 直接写 X = max(1, hp-1) 的"最大化"策略
 *   - UI 层后续可接入弹窗询问 X 值
 */
import type { SkillRegistration } from '../types';

export const skill_situnan_xiulian: SkillRegistration = {
  id: 'bssr_situnan.battle',
  name: '天逆珠·修炼',
  description:
    '主动发动，可减少自身X点气血（X≤当前气血-1），让另1名友军所有属性各增加X点（不可超上限，心境最多+2）',
  isActive: true,
  targetSelector: { kind: 'single_any_character' }, // UI 层再按 friendly 过滤
  maxCasts: Infinity, // Q80：无次数限制
  precheck: (self) => {
    if (self.hp.current < 2) {
      return { ok: false, reason: '自身气血过低（需 ≥2）' };
    }
    return { ok: true };
  },
  activeCast: (self, targetIds, engine) => {
    if (targetIds.length !== 1) {
      engine.emit(
        'skill_effect_blocked',
        { skillId: 'bssr_situnan.battle', reason: 'no_target' },
        `「天逆珠·修炼」发动失败——未指定目标`,
        { actorId: self.id, skillId: 'bssr_situnan.battle', severity: 'info' },
      );
      return { consumed: false };
    }
    const target = engine.getUnit(targetIds[0]);
    if (!target || !target.isAlive || target.owner !== self.owner || target.id === self.id) {
      engine.emit(
        'skill_effect_blocked',
        { skillId: 'bssr_situnan.battle', reason: 'invalid_target' },
        `「天逆珠·修炼」发动失败——目标必须为另1名友军`,
        { actorId: self.id, skillId: 'bssr_situnan.battle', severity: 'info' },
      );
      return { consumed: false };
    }

    // MVP：X = hp - 1（最大化）
    const X = self.hp.current - 1;
    if (X < 1) {
      engine.emit(
        'skill_effect_blocked',
        { skillId: 'bssr_situnan.battle', reason: 'X_zero' },
        `「天逆珠·修炼」发动失败——自身气血过低`,
        { actorId: self.id, skillId: 'bssr_situnan.battle', severity: 'info' },
      );
      return { consumed: false };
    }

    engine.emit(
      'skill_active_cast',
      { skillId: 'bssr_situnan.battle', X },
      `「天逆珠·修炼」发动：消耗 ${X} 点气血为 ${target.name} 增益`,
      { actorId: self.id, targetIds: [target.id], skillId: 'bssr_situnan.battle', severity: 'highlight' },
    );

    engine.changeStat(self.id, 'hp', -X, {
      permanent: false,
      reason: '天逆珠·修炼消耗',
      skillId: 'bssr_situnan.battle',
    });
    engine.changeStat(target.id, 'hp', +X, {
      permanent: true,
      breakCap: false,
      reason: '天逆珠·修炼加持',
      skillId: 'bssr_situnan.battle',
    });
    engine.changeStat(target.id, 'atk', +X, {
      permanent: true,
      breakCap: false,
      reason: '天逆珠·修炼加持',
      skillId: 'bssr_situnan.battle',
    });
    engine.changeStat(target.id, 'mnd', +Math.min(X, 2), {
      permanent: true,
      breakCap: false,
      reason: '天逆珠·修炼加持（心境最多+2）',
      skillId: 'bssr_situnan.battle',
    });

    // Q80：无次数限制，不消耗"绝技"额度
    return { consumed: false };
  },
  hooks: {},
};
