/**
 * 【李慕婉 / 情深不渝】绑定SR · 绝技
 *
 * 策划原文：李慕婉主动退场时，使旺林所有属性永久+2（可突破上限）
 *
 * 契约登记：
 *   trigger  : active_once + on_self_sacrifice
 */
import type { SkillRegistration, HookHandler } from '../types';

/**
 * 设计：此技能本身是 active_once（玩家按按钮触发"主动献祭"），
 * activeCast 里让 self 主动退场（hp → 0, attackKind='self_damage'），
 * 并在 on_self_sacrifice 钩子中结算旺林增益。
 *
 * 为简化 MVP，将结算直接写在 activeCast 里。
 */
export const skill_limuwan_qingshen: SkillRegistration = {
  id: 'bsr_limuwan.ult',
  name: '情深不渝',
  description: '李慕婉主动退场时，使旺林所有属性永久+2（可突破上限）',
  isActive: true,
  targetSelector: { kind: 'none' },
  maxCasts: 1,
  precheck: (self, engine) => {
    const wanglin = engine
      .getAllUnits()
      .find(
        (u) =>
          u.isAlive &&
          u.owner === self.owner &&
          (u.id.includes('wanglin') || u.name.includes('旺林')),
      );
    if (!wanglin) return { ok: false, reason: '旺林不在场' };
    return { ok: true, candidateIds: [wanglin.id] };
  },
  activeCast: (self, _targetIds, engine) => {
    const wanglin = engine
      .getAllUnits()
      .find(
        (u) =>
          u.isAlive &&
          u.owner === self.owner &&
          (u.id.includes('wanglin') || u.name.includes('旺林')),
      );
    if (!wanglin) return { consumed: false };

    engine.emit(
      'skill_active_cast',
      { skillId: 'bsr_limuwan.ult' },
      `「情深不渝」发动：李慕婉以生命托付旺林`,
      { actorId: self.id, targetIds: [wanglin.id], skillId: 'bsr_limuwan.ult', severity: 'climax' },
    );
    // 先给旺林加成
    engine.changeStat(wanglin.id, 'hp', +2, {
      permanent: true,
      breakCap: true,
      reason: '情深不渝',
      skillId: 'bsr_limuwan.ult',
    });
    engine.changeStat(wanglin.id, 'atk', +2, {
      permanent: true,
      breakCap: true,
      reason: '情深不渝',
      skillId: 'bsr_limuwan.ult',
    });
    engine.changeStat(wanglin.id, 'mnd', +2, {
      permanent: true,
      breakCap: true,
      reason: '情深不渝',
      skillId: 'bsr_limuwan.ult',
    });
    // 再让李慕婉献祭退场
    engine.changeStat(self.id, 'hp', -self.hp.current, {
      permanent: false,
      reason: '情深不渝·自我献祭',
      skillId: 'bsr_limuwan.ult',
    });
    return { consumed: true };
  },
  hooks: {
    on_self_sacrifice: ((ctx, engine) => {
      // 已在 activeCast 中结算；此处仅作为契约一致性钩子占位
      engine.emit(
        'skill_passive_trigger',
        { skillId: 'bsr_limuwan.ult', phase: 'sacrifice_confirmed' },
        `${ctx.defender.name} 情深不渝，归于虚无`,
        { actorId: ctx.defender.id, skillId: 'bsr_limuwan.ult', severity: 'info' },
      );
    }) as HookHandler,
  },
};
