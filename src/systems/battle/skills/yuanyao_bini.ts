/**
 * 【缘瑶 / 阴灵蔽日】通用 SR · SR 绝技
 *
 * 策划原文：
 *   缘瑶退场时（主动/被动），可指定夺取对方 1 名角色成为己方角色（主角卡除外，继承所有状态）
 *
 * 关键语义（2026-05-11 修订）：
 *   1. 「主动/被动」= 玩家可任意时刻按绝技按钮发动；同时被打死也会触发（兜底）
 *   2. 主动发动：缘瑶自我退场（hp=0, dead=true）+ 夺取一名指定的非主角敌方
 *   3. 被动发动：缘瑶被击杀的瞬间，触发 on_self_leave，自动取第一个非主角敌方
 *   4. 主动与被动互斥：主动用过后 ultimateUsed=true，被动 hook 仍可作为兜底
 *      （被动只在 ultimateUsed === false 时触发，避免双重夺取）
 *   5. 「夺取」= 翻转目标的 isEnemy（store 内 owner 由 isEnemy 派生）
 *      行动队列每大回合 startNewRound 重排，所以本回合内被夺者保持原行动顺序，
 *      下大回合按新 isEnemy 入队 —— 与策划"行动回合不变"完全吻合
 */
import type { SkillRegistration, HookHandler, TargetSelector } from '../types';

export const skill_yuanyao_bini: SkillRegistration = {
  id: 'sr_yuanyao.ultimate',
  name: '阴灵蔽日',
  description: '主动/被动 · 缘瑶退场（自我牺牲），夺取 1 名敌方非主角卡为己方（继承所有状态）',

  /* ============== 主动版本 ============== */
  isActive: true,
  targetSelector: { kind: 'single_any_enemy' } satisfies TargetSelector,
  maxCasts: 1,

  /** 至少有 1 名非主角敌方时才可发动 */
  precheck: (self, engine) => {
    if (self.ultimateUsed) return { ok: false, reason: '绝技已使用' };
    const targets = engine
      .getEnemiesOf(self)
      .filter((e) => e.isAlive && !e.id.includes('hero_'));
    if (targets.length === 0) {
      return { ok: false, reason: '场上无可夺取的非主角敌方' };
    }
    return { ok: true, candidateIds: targets.map((t) => t.id) };
  },

  /** 玩家点选目标后：自我退场 + 夺取对方 */
  activeCast: (self, targetIds, engine) => {
    const tid = targetIds[0];
    const target = tid ? engine.getUnit(tid) : undefined;
    if (!target || !target.isAlive) return { consumed: false };
    if (target.id.includes('hero_')) {
      engine.emit(
        'skill_effect_blocked',
        { skillId: 'sr_yuanyao.ultimate' },
        `阴灵蔽日不可夺取主角卡`,
        { actorId: self.id, skillId: 'sr_yuanyao.ultimate', severity: 'info' },
      );
      return { consumed: false };
    }

    // ① 缘瑶自我退场（hp 设 0，触发死亡管线）
    engine.emit(
      'skill_active_cast',
      { skillId: 'sr_yuanyao.ultimate', targetId: target.id },
      `🌙 ${self.name} 发动【阴灵蔽日】，自我消散以夺取 ${target.name}`,
      {
        actorId: self.id,
        targetIds: [target.id],
        skillId: 'sr_yuanyao.ultimate',
        severity: 'climax',
      },
    );
    engine.changeStat(self.id, 'hp', -self.hp.current, {
      permanent: false,
      reason: '阴灵蔽日 · 自我牺牲',
      skillId: 'sr_yuanyao.ultimate',
    });

    // ② 夺取目标：emit 一条 ownership_change（store 监听此 event 翻转 isEnemy）
    engine.emit(
      'ownership_change',
      { targetId: target.id, from: target.owner, to: self.owner },
      `🌑 阴灵蔽日：${target.name} 归属转变为 ${self.owner}（继承全部状态）`,
      {
        actorId: self.id,
        targetIds: [target.id],
        skillId: 'sr_yuanyao.ultimate',
        severity: 'climax',
      },
    );

    // ③ 标记 ultimateUsed，让 on_self_leave 兜底跳过
    self.ultimateUsed = true;

    return { consumed: true };
  },

  /* ============== 被动版本（兜底）============== */
  hooks: {
    on_self_leave: ((ctx, engine) => {
      const self =
        engine.getUnit(ctx.attacker.id) ?? engine.getUnit(ctx.defender.id);
      if (!self) return;
      // 主动版本已用过：跳过被动兜底，避免双重夺取
      if (self.ultimateUsed) return;

      const targets = engine
        .getEnemiesOf(self)
        .filter((e) => e.isAlive && !e.id.includes('hero_'));
      if (targets.length === 0) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'sr_yuanyao.ultimate' },
          `阴灵蔽日未生效——对方仅存主角卡`,
          { actorId: self.id, skillId: 'sr_yuanyao.ultimate', severity: 'info' },
        );
        return;
      }
      const target = targets[0]; // 被动兜底：取第一个非主角
      engine.emit(
        'ownership_change',
        { targetId: target.id, from: target.owner, to: self.owner },
        `🌑 阴灵蔽日（被动）：${target.name} 归属转变为 ${self.owner}`,
        {
          actorId: self.id,
          targetIds: [target.id],
          skillId: 'sr_yuanyao.ultimate',
          severity: 'climax',
        },
      );
      self.ultimateUsed = true;
    }) as HookHandler,
  },
};
