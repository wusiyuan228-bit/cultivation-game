/**
 * 【玫渡纱 / 蛇后之瞳·石化】通用SSR · 绝技
 * 策划原文：玫渡纱退场时（主动/被动），可让1名指定角色永远无法移动
 *
 * 【2026-05-11 实装升级】：双形态拆分
 *   - 主动路径：玩家点击绝技按钮 → 选目标 → 石化目标 → 玫渡纱自残退场
 *   - 被动路径：被打死时由 on_self_leave 自动选 atk 最高的敌人（兜底）
 */
import type { Modifier, SkillRegistration, HookHandler, TargetSelector } from '../types';
import { PRIORITY } from '../types';

/** 共用：让目标永久无法移动 */
function castShihua(self: any, target: any, engine: any, source: 'active' | 'passive') {
  const mod: Modifier = {
    id: `shihua_${target.id}`,
    sourceSkillId: 'ssr_meidusa.ult',
    sourceUnitId: self.id,
    category: 'permanent',
    targetUnitId: target.id,
    kind: 'disable_move',
    payload: {},
    duration: { type: 'permanent' },
    priority: PRIORITY.TEMPORAL,
  };
  engine.attachModifier(mod);
  engine.emit(
    'skill_passive_trigger',
    { skillId: 'ssr_meidusa.ult', auto: source === 'passive' },
    `「蛇后之瞳·石化」${source === 'active' ? '（主动退场）' : '触发'}：${target.name} 被永久石化`,
    { actorId: self.id, targetIds: [target.id], skillId: 'ssr_meidusa.ult', severity: 'climax' },
  );
}

export const skill_meidusa_shihua: SkillRegistration = {
  id: 'ssr_meidusa.ult',
  name: '蛇后之瞳·石化',
  description: '主动退场，让 1 名指定角色永远无法移动（被动战死时也会自动触发）',
  isActive: true,
  targetSelector: { kind: 'single_any_enemy' } satisfies TargetSelector,
  maxCasts: 1,
  precheck: (self, engine) => {
    if (self.ultimateUsed) return { ok: false, reason: '绝技已使用' };
    const candidates = engine
      .getAllUnits()
      .filter((u: any) => u.isAlive && u.id !== self.id);
    if (candidates.length === 0) {
      return { ok: false, reason: '蛇后之瞳·石化发动失败——场上无可选目标' };
    }
    return { ok: true, candidateIds: candidates.map((u: any) => u.id) };
  },
  activeCast: (self, targetIds, engine) => {
    const tid = targetIds[0];
    const target = tid ? engine.getUnit(tid) : undefined;
    if (!target || !target.isAlive) return { consumed: false };
    castShihua(self, target, engine, 'active');
    // 主动退场
    engine.changeStat(self.id, 'hp', -self.hp.current, {
      permanent: false,
      reason: 'self_sacrifice',
      skillId: 'ssr_meidusa.ult',
    });
    engine.emit(
      'unit_leave',
      { unitId: self.id, reason: 'sacrifice' },
      `🏳 ${self.name} 主动退场（蛇后之瞳·石化）`,
      { actorId: self.id, skillId: 'ssr_meidusa.ult', severity: 'climax' },
    );
    self.ultimateUsed = true;
    return { consumed: true };
  },
  hooks: {
    on_self_leave: ((ctx, engine) => {
      const self = engine.getUnit(ctx.defender.id) ?? engine.getUnit(ctx.attacker.id);
      if (!self) return;
      // 主动路径已用过：跳过被动兜底
      if ((self as any).ultimateUsed) return;
      const candidates = engine
        .getAllUnits()
        .filter((u) => u.isAlive && u.id !== self.id);
      if (candidates.length === 0) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'ssr_meidusa.ult', reason: 'no_target' },
          `「蛇后之瞳·石化」未生效——场上已无可选目标`,
          { actorId: self.id, skillId: 'ssr_meidusa.ult', severity: 'info' },
        );
        return;
      }
      // 被动 MVP：选敌方 atk 最高者
      const enemies = candidates.filter((u) => u.owner !== self.owner);
      const target =
        enemies.length > 0
          ? enemies.sort((a, b) => b.atk.current - a.atk.current)[0]
          : candidates[0];
      castShihua(self, target, engine, 'passive');
    }) as HookHandler,
  },
};
