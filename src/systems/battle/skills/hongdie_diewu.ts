/**
 * 【鸿蝶 / 蝶舞红尘】通用SR · 战斗技能
 * 原文：鸿蝶退场时（主动/被动），可指定任一角色 1 个未使用的绝技作废
 *
 * 【2026-05-11 实装升级】：双形态拆分
 *   - 主动路径：玩家点击绝技按钮 → 选目标 → 作废其绝技 → 鸿蝶自残退场
 *   - 被动路径：被打死时由 on_self_leave 自动选第一个 ultimateUsed=false 的角色（兜底）
 */
import type { SkillRegistration, HookHandler, Modifier, TargetSelector } from '../types';
import { PRIORITY } from '../types';

/** 共用：作废目标绝技 */
function castDiewu(self: any, target: any, engine: any, source: 'active' | 'passive') {
  const mod: Modifier = {
    id: `dwht_${target.id}_${engine.nextSeq()}`,
    sourceSkillId: 'sr_hongdie.battle',
    sourceUnitId: self.id,
    category: 'permanent',
    targetUnitId: target.id,
    kind: 'ultimate_invalidated',
    payload: {},
    duration: { type: 'permanent_in_battle' },
    priority: PRIORITY.CONSTANT,
  };
  engine.attachModifier(mod);
  engine.emit(
    'skill_passive_trigger',
    { skillId: 'sr_hongdie.battle', auto: source === 'passive' },
    `蝶舞红尘${source === 'active' ? '（主动退场）' : '触发'}：作废 ${target.name} 的绝技（本场不可再使用）`,
    { actorId: self.id, targetIds: [target.id], skillId: 'sr_hongdie.battle', severity: 'climax' },
  );
}

export const skill_hongdie_diewu: SkillRegistration = {
  id: 'sr_hongdie.battle',
  name: '蝶舞红尘',
  description: '主动退场，作废 1 名角色的未使用绝技（被动战死时也会自动触发）',
  isActive: true,
  targetSelector: { kind: 'single_any_enemy' } satisfies TargetSelector,
  maxCasts: 1,
  precheck: (self, engine) => {
    if (self.ultimateUsed) return { ok: false, reason: '绝技已使用' };
    const candidates = engine
      .getAllUnits()
      .filter((u: any) => u.isAlive && u.id !== self.id && !u.ultimateUsed);
    if (candidates.length === 0) {
      return { ok: false, reason: '蝶舞红尘发动失败 —— 无未使用绝技的目标' };
    }
    return { ok: true, candidateIds: candidates.map((u: any) => u.id) };
  },
  activeCast: (self, targetIds, engine) => {
    const tid = targetIds[0];
    const target = tid ? engine.getUnit(tid) : undefined;
    if (!target || !target.isAlive) return { consumed: false };
    if (target.ultimateUsed) {
      engine.emit(
        'skill_effect_blocked',
        { skillId: 'sr_hongdie.battle' },
        `${target.name} 已无未使用的绝技`,
        { actorId: self.id, skillId: 'sr_hongdie.battle', severity: 'info' },
      );
      return { consumed: false };
    }
    castDiewu(self, target, engine, 'active');
    // 主动退场
    engine.changeStat(self.id, 'hp', -self.hp.current, {
      permanent: false,
      reason: 'self_sacrifice',
      skillId: 'sr_hongdie.battle',
    });
    engine.emit(
      'unit_leave',
      { unitId: self.id, reason: 'sacrifice' },
      `🏳 ${self.name} 主动退场（蝶舞红尘）`,
      { actorId: self.id, skillId: 'sr_hongdie.battle', severity: 'climax' },
    );
    self.ultimateUsed = true;
    return { consumed: true };
  },
  hooks: {
    /** 被动退场（被打死）兜底：自动选第一个未使用绝技的角色 */
    on_self_leave: ((ctx, engine) => {
      const self = engine.getUnit(ctx.attacker.id) ?? engine.getUnit(ctx.defender.id);
      if (!self) return;
      // 主动路径已用过：跳过被动兜底
      if ((self as any).ultimateUsed) return;
      const target = engine
        .getAllUnits()
        .find((u) => u.isAlive && u.id !== self.id && !u.ultimateUsed);
      if (!target) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'sr_hongdie.battle' },
          `蝶舞红尘发动——无未使用绝技的目标`,
          { actorId: self.id, skillId: 'sr_hongdie.battle', severity: 'info' },
        );
        return;
      }
      castDiewu(self, target, engine, 'passive');
    }) as HookHandler,
  },
};
