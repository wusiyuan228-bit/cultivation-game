/**
 * 【岱牧百 / 白虎裂光波】通用SR · SR绝技
 * 原文：岱牧百退场时（主动/被动），对四个方向相邻的所有角色造成4点固定伤害
 *
 * 【2026-05-10 实装升级】：拆分为「主动退场」+「被动退场」双路径
 *   - 主动路径：玩家点击绝技按钮 → activeCast：先 AOE 伤害 → 自残退场（标记 ultimateUsed）
 *   - 被动路径：被攻击致死时，由 engine 触发 on_self_leave hook（兜底，避免漏触发）
 *   - precheck：四向相邻有任意角色（含友军，按"角色"语义）时即可发动
 */
import type { SkillRegistration, HookHandler, TargetSelector } from '../types';

/** 共用：施加四向相邻 4 点固伤的核心逻辑 */
function castLiguangbo(self: any, engine: any, source: 'active' | 'passive') {
  const around = engine
    .getAllUnits()
    .filter((u: any) => u.isAlive && u.id !== self.id && Math.abs(u.row - self.row) + Math.abs(u.col - self.col) === 1);
  if (around.length === 0) {
    engine.emit(
      'skill_effect_blocked',
      { skillId: 'sr_daimubai.ultimate' },
      `白虎裂光波发动但四向无相邻角色`,
      { actorId: self.id, skillId: 'sr_daimubai.ultimate', severity: 'info' },
    );
    return;
  }
  engine.emit(
    'skill_active_cast',
    { skillId: 'sr_daimubai.ultimate', auto: source === 'passive', targets: around.map((u: any) => u.id) },
    `白虎裂光波${source === 'active' ? '（主动退场）' : '触发'}，对 ${around.length} 名相邻角色各造成 4 点固伤`,
    { actorId: self.id, targetIds: around.map((u: any) => u.id), skillId: 'sr_daimubai.ultimate', severity: 'climax' },
  );
  around.forEach((u: any) => {
    engine.changeStat(u.id, 'hp', -4, {
      permanent: false,
      reason: '白虎裂光波',
      skillId: 'sr_daimubai.ultimate',
    });
  });
}

export const skill_daimubai_liguangbo: SkillRegistration = {
  id: 'sr_daimubai.ultimate',
  name: '白虎裂光波',
  description: '主动退场，对四向相邻所有角色造成 4 点固定伤害（被动战死时也会自动触发）',
  isActive: true,
  // 无目标选择器（auto AOE / 主动退场型）→ 走 performUltimate 直接施放路径
  targetSelector: { kind: 'none' } satisfies TargetSelector,
  maxCasts: 1,
  hooks: {
    /** 被动退场（被攻击致死等场景）兜底：自动 AOE 一次 */
    on_self_leave: ((ctx, engine) => {
      const self = engine.getUnit(ctx.attacker.id) ?? engine.getUnit(ctx.defender.id);
      if (!self) return;
      // 主动路径下 ultimateUsed=true 已被预先标记 → 跳过避免重复触发
      if ((self as any).ultimateUsed) return;
      castLiguangbo(self, engine, 'passive');
    }) as HookHandler,
  },
  precheck: (self, engine) => {
    if (self.ultimateUsed) return { ok: false, reason: '绝技已使用' };
    const all = engine.getAllUnits();
    const around = all.filter(
      (u: any) =>
        u.isAlive &&
        u.id !== self.id &&
        Math.abs(u.row - self.row) + Math.abs(u.col - self.col) === 1,
    );
    if (around.length === 0) {
      return { ok: false, reason: '白虎裂光波发动失败 —— 四向无相邻角色' };
    }
    return { ok: true, candidateIds: around.map((u: any) => u.id) };
  },
  activeCast: (self, _targetIds, engine) => {
    // —— 1) 先 AOE 伤害 ——
    castLiguangbo(self, engine, 'active');
    // —— 2) 自残退场（hp 清零）——
    engine.changeStat(self.id, 'hp', -self.hp.current, {
      permanent: false,
      reason: 'self_sacrifice',
      skillId: 'sr_daimubai.ultimate',
    });
    engine.emit(
      'unit_leave',
      { unitId: self.id, reason: 'sacrifice' },
      `🏳 ${self.name} 主动退场（白虎裂光波）`,
      { actorId: self.id, skillId: 'sr_daimubai.ultimate', severity: 'climax' },
    );
    self.ultimateUsed = true;
    return { consumed: true };
  },
};
