/**
 * 【凝丰志 / 七宝仙品·极致增幅】通用SSR · 绝技
 * 策划原文：主动发动，可额外指定2名自身相邻的己方角色与自己一起对1名敌人发动攻击（3次独立攻击）
 * Q43：协同友军本轮不消耗行动
 *
 * P3 阶段（2026-05-01）：
 *   - engine 层 activeCast 仅 emit "意图"（选中协同友军 + 目标敌人）
 *   - store 层按 coAllies 顺序串行发起 3 次 resolveAttack（每段独立结算）
 *   - 协同友军本轮不消耗行动（Q43 由 store 层保证）
 */
import type { SkillRegistration } from '../types';

export const skill_ningfeng_zengfu: SkillRegistration = {
  id: 'ssr_ningfengzhi.ult',
  name: '七宝仙品·极致增幅',
  description: '主动发动，额外指定2名相邻己方与自己一起对1名敌人发动3次独立攻击',
  isActive: true,
  targetSelector: { kind: 'single_adjacent_enemy' },
  maxCasts: 1,
  precheck: (self, engine) => {
    const enemies = engine
      .getEnemiesOf(self)
      .filter(
        (u) => u.isAlive && Math.abs(u.row - self.row) + Math.abs(u.col - self.col) === 1,
      );
    if (enemies.length === 0) return { ok: false, reason: '相邻无敌方' };
    return { ok: true, candidateIds: enemies.map((u) => u.id) };
  },
  activeCast: (self, targetIds, engine) => {
    if (targetIds.length !== 1) return { consumed: false };
    const target = engine.getUnit(targetIds[0]);
    if (!target || !target.isAlive) return { consumed: false };

    const coAllies = engine
      .getAlliesOf(self)
      .filter(
        (u) =>
          u.isAlive &&
          u.id !== self.id &&
          Math.abs(u.row - self.row) + Math.abs(u.col - self.col) === 1,
      )
      .slice(0, 2);

    const attackers = [self, ...coAllies];
    engine.emit(
      'skill_active_cast',
      {
        skillId: 'ssr_ningfengzhi.ult',
        attackerCount: attackers.length,
        coAllies: coAllies.map((a) => a.id),
        target: target.id,
      },
      `「七宝仙品·极致增幅」发动，${attackers.length} 人协同攻击 ${target.name}`,
      { actorId: self.id, targetIds: [target.id], skillId: 'ssr_ningfengzhi.ult', severity: 'climax' },
    );

    // 真实 3 段 resolveAttack 由 store 层路由展开
    // （见 s7bBattleStore.ts performUltimate - ningfeng_multi_segment 分支）
    return { consumed: true };
  },
  hooks: {},
};
