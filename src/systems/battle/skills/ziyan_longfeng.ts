/**
 * 【子妍 / 龙凤变】通用SR · SR绝技
 * 原文：子妍退场时（主动/被动），对所在行与列的所有角色造成2点固定伤害
 * Q54 自动触发
 *
 * 【2026-05-11 实装升级】：双形态拆分
 *   - 主动路径：玩家点击绝技按钮 → 行列 AOE → 子妍自残退场
 *   - 被动路径：被打死时由 on_self_leave 自动 AOE（兜底）
 */
import type { SkillRegistration, HookHandler, TargetSelector } from '../types';

/** 共用：行列 AOE 2 点固伤 */
function castLongfeng(self: any, engine: any, source: 'active' | 'passive') {
  const line = engine
    .getAllUnits()
    .filter((u: any) => u.isAlive && u.id !== self.id && (u.row === self.row || u.col === self.col));
  if (line.length === 0) {
    engine.emit(
      'skill_effect_blocked',
      { skillId: 'sr_ziyan.ultimate' },
      `龙凤变发动但所在行列无其他角色`,
      { actorId: self.id, skillId: 'sr_ziyan.ultimate', severity: 'info' },
    );
    return;
  }
  engine.emit(
    'skill_active_cast',
    { skillId: 'sr_ziyan.ultimate', auto: source === 'passive', targets: line.map((u: any) => u.id) },
    `龙凤变${source === 'active' ? '（主动退场）' : '触发'}：${line.length} 名行列角色各承受 2 点固伤`,
    { actorId: self.id, targetIds: line.map((u: any) => u.id), skillId: 'sr_ziyan.ultimate', severity: 'climax' },
  );
  line.forEach((u: any) => {
    engine.changeStat(u.id, 'hp', -2, {
      permanent: false,
      reason: '龙凤变',
      skillId: 'sr_ziyan.ultimate',
    });
  });
}

export const skill_ziyan_longfeng: SkillRegistration = {
  id: 'sr_ziyan.ultimate',
  name: '龙凤变',
  description: '主动退场，对所在行/列所有角色造成 2 点固伤（被动战死时也会自动触发）',
  isActive: true,
  targetSelector: { kind: 'none' } satisfies TargetSelector,
  maxCasts: 1,
  precheck: (self, engine) => {
    if (self.ultimateUsed) return { ok: false, reason: '绝技已使用' };
    const line = engine
      .getAllUnits()
      .filter((u: any) => u.isAlive && u.id !== self.id && (u.row === self.row || u.col === self.col));
    if (line.length === 0) {
      return { ok: false, reason: '龙凤变发动失败 —— 行列无其他角色' };
    }
    return { ok: true, candidateIds: line.map((u: any) => u.id) };
  },
  activeCast: (self, _targetIds, engine) => {
    castLongfeng(self, engine, 'active');
    engine.changeStat(self.id, 'hp', -self.hp.current, {
      permanent: false,
      reason: 'self_sacrifice',
      skillId: 'sr_ziyan.ultimate',
    });
    engine.emit(
      'unit_leave',
      { unitId: self.id, reason: 'sacrifice' },
      `🏳 ${self.name} 主动退场（龙凤变）`,
      { actorId: self.id, skillId: 'sr_ziyan.ultimate', severity: 'climax' },
    );
    self.ultimateUsed = true;
    return { consumed: true };
  },
  hooks: {
    on_self_leave: ((ctx, engine) => {
      const self = engine.getUnit(ctx.attacker.id) ?? engine.getUnit(ctx.defender.id);
      if (!self) return;
      if ((self as any).ultimateUsed) return;
      castLongfeng(self, engine, 'passive');
    }) as HookHandler,
  },
};
