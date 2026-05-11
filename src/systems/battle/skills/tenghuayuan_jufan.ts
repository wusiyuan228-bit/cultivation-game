/**
 * 【腾华原 / 黑泥潭·聚魂幡】通用SR · SR绝技
 * 原文：腾华原退场时（主动/被动），可操纵最多 3 个角色各移动一次（按其 mnd 距离）
 *
 * 【2026-05-11 实装升级】：双形态拆分
 *   - 主动路径：玩家点击绝技按钮 → 自动选 mnd>0 的前 3 名 → 操纵移动 → 腾华原自残退场
 *   - 被动路径：被打死时由 on_self_leave 兜底
 *
 * 注：当前 MVP 阶段「真实移动」由 store 层处理（参见 s7bBattleStore.ts:1688 注释），
 *      本文件只 emit 意图；真实棋盘移动需要另起 commit 完成 UI 选位交互。
 */
import type { SkillRegistration, HookHandler, TargetSelector } from '../types';

/** 共用：发出操纵意图（MVP 不做真实移动） */
function castJufan(self: any, engine: any, source: 'active' | 'passive') {
  const candidates = engine
    .getAllUnits()
    .filter((u: any) => u.isAlive && u.id !== self.id && u.mnd.current > 0)
    .slice(0, 3);
  if (candidates.length === 0) {
    engine.emit(
      'skill_effect_blocked',
      { skillId: 'sr_tenghuayuan.ultimate' },
      `黑泥潭·聚魂幡未生效——无可操纵角色`,
      { actorId: self.id, skillId: 'sr_tenghuayuan.ultimate', severity: 'info' },
    );
    return;
  }
  engine.emit(
    'skill_active_cast',
    { skillId: 'sr_tenghuayuan.ultimate', auto: source === 'passive', targets: candidates.map((u: any) => u.id) },
    `黑泥潭·聚魂幡${source === 'active' ? '（主动退场）' : '触发'}：操纵 ${candidates.length} 名角色按其 mnd 距离移动`,
    { actorId: self.id, targetIds: candidates.map((u: any) => u.id), skillId: 'sr_tenghuayuan.ultimate', severity: 'climax' },
  );
}

export const skill_tenghuayuan_jufan: SkillRegistration = {
  id: 'sr_tenghuayuan.ultimate',
  name: '黑泥潭·聚魂幡',
  description: '主动退场，操纵最多 3 名角色各移动一次（按其 mnd 距离；被动战死时也会自动触发）',
  isActive: true,
  targetSelector: { kind: 'none' } satisfies TargetSelector,
  maxCasts: 1,
  precheck: (self, engine) => {
    if (self.ultimateUsed) return { ok: false, reason: '绝技已使用' };
    const candidates = engine
      .getAllUnits()
      .filter((u: any) => u.isAlive && u.id !== self.id && u.mnd.current > 0);
    if (candidates.length === 0) {
      return { ok: false, reason: '黑泥潭·聚魂幡发动失败 —— 无可操纵角色' };
    }
    return { ok: true, candidateIds: candidates.slice(0, 3).map((u: any) => u.id) };
  },
  activeCast: (self, _targetIds, engine) => {
    castJufan(self, engine, 'active');
    engine.changeStat(self.id, 'hp', -self.hp.current, {
      permanent: false,
      reason: 'self_sacrifice',
      skillId: 'sr_tenghuayuan.ultimate',
    });
    engine.emit(
      'unit_leave',
      { unitId: self.id, reason: 'sacrifice' },
      `🏳 ${self.name} 主动退场（黑泥潭·聚魂幡）`,
      { actorId: self.id, skillId: 'sr_tenghuayuan.ultimate', severity: 'climax' },
    );
    self.ultimateUsed = true;
    return { consumed: true };
  },
  hooks: {
    on_self_leave: ((ctx, engine) => {
      const self = engine.getUnit(ctx.attacker.id) ?? engine.getUnit(ctx.defender.id);
      if (!self) return;
      if ((self as any).ultimateUsed) return;
      castJufan(self, engine, 'passive');
    }) as HookHandler,
  },
};
