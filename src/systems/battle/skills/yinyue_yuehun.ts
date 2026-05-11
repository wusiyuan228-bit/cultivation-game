/**
 * 【隐月 / 月魂献祭】绑定SR · 绝技
 *
 * 策划原文：隐月退场时（主动/被动），寒立永久修为+2、气血+2（可突破上限）
 *
 * 【2026-05-11 实装升级】：双形态拆分
 *   - 主动路径：玩家点击绝技按钮 → 给寒立 buff → 隐月自残退场
 *   - 被动路径：被打死时由 on_self_leave 自动结算（兜底）
 *
 * 契约登记：
 *   trigger  : on_self_leave + active
 *   effect   : buff_target（hero_hanli 及其觉醒形态通吃 · Q19）
 */
import type { SkillRegistration, HookHandler, TargetSelector } from '../types';

/** 共用：寒立永久 atk+2 hp+2 */
function castYuehun(self: any, hanli: any, engine: any, source: 'active' | 'passive') {
  engine.emit(
    'skill_passive_trigger',
    { skillId: 'bsr_yinyue.ult', auto: source === 'passive' },
    `「月魂献祭」${source === 'active' ? '（主动退场）' : '触发'}，${hanli.name} 修为 +2、气血 +2`,
    { actorId: self.id, targetIds: [hanli.id], skillId: 'bsr_yinyue.ult', severity: 'climax' },
  );
  engine.changeStat(hanli.id, 'atk', +2, {
    permanent: true,
    breakCap: true,
    reason: '月魂献祭',
    skillId: 'bsr_yinyue.ult',
  });
  engine.changeStat(hanli.id, 'hp', +2, {
    permanent: true,
    breakCap: true,
    reason: '月魂献祭',
    skillId: 'bsr_yinyue.ult',
  });
}

/** 寻找寒立（本体或觉醒形态） */
function findHanli(self: any, engine: any) {
  return engine
    .getAllUnits()
    .find(
      (u: any) =>
        u.isAlive &&
        u.owner === self.owner &&
        (u.id.includes('hanli') || u.name.includes('寒立')),
    );
}

export const skill_yinyue_yuehun: SkillRegistration = {
  id: 'bsr_yinyue.ult',
  name: '月魂献祭',
  description: '主动退场，使寒立永久修为+2、气血+2（可突破上限；被动战死时也会自动触发）',
  isActive: true,
  targetSelector: { kind: 'none' } satisfies TargetSelector,
  maxCasts: 1,
  precheck: (self, engine) => {
    if (self.ultimateUsed) return { ok: false, reason: '绝技已使用' };
    const hanli = findHanli(self, engine);
    if (!hanli) return { ok: false, reason: '月魂献祭发动失败 —— 寒立不在场' };
    return { ok: true, candidateIds: [hanli.id] };
  },
  activeCast: (self, _targetIds, engine) => {
    const hanli = findHanli(self, engine);
    if (!hanli) return { consumed: false };
    castYuehun(self, hanli, engine, 'active');
    engine.changeStat(self.id, 'hp', -self.hp.current, {
      permanent: false,
      reason: 'self_sacrifice',
      skillId: 'bsr_yinyue.ult',
    });
    engine.emit(
      'unit_leave',
      { unitId: self.id, reason: 'sacrifice' },
      `🏳 ${self.name} 主动退场（月魂献祭）`,
      { actorId: self.id, skillId: 'bsr_yinyue.ult', severity: 'climax' },
    );
    self.ultimateUsed = true;
    return { consumed: true };
  },
  hooks: {
    on_self_leave: ((ctx, engine) => {
      const self = engine.getUnit(ctx.defender.id) ?? engine.getUnit(ctx.attacker.id);
      if (!self) return;
      if ((self as any).ultimateUsed) return;
      const hanli = findHanli(self, engine);
      if (!hanli) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'bsr_yinyue.ult', reason: 'no_hanli' },
          `「月魂献祭」未生效——寒立不在场`,
          { actorId: self.id, skillId: 'bsr_yinyue.ult', severity: 'info' },
        );
        return;
      }
      castYuehun(self, hanli, engine, 'passive');
    }) as HookHandler,
  },
};
