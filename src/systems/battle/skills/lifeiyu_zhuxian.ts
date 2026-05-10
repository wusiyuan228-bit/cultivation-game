/**
 * 【立飞羽 / 灵剑·诛仙】通用SR · SR绝技
 * 原文：主动发动，对 1 名相邻敌人进行攻击，若目标当前气血≤3则退场
 * Q61：按攻击后判定
 * MVP：在 activeCast 标记意图，store 层发起攻击后在 on_after_hit 判定
 */
import type { SkillRegistration, HookHandler, BattleUnit, IBattleEngine } from '../types';

export const skill_lifeiyu_zhuxian: SkillRegistration = {
  id: 'sr_lifeiyu.ultimate',
  name: '灵剑·诛仙',
  description: '对相邻 1 名敌人攻击，攻击后若其 hp≤3 则直接退场',
  isActive: true,
  maxCasts: 1,
  targetSelector: { kind: 'single_adjacent_enemy' },
  precheck: (self: BattleUnit, engine: IBattleEngine) => {
    const adj = engine
      .getEnemiesOf(self)
      .filter((e) => e.isAlive && Math.abs(e.row - self.row) + Math.abs(e.col - self.col) === 1);
    return adj.length > 0
      ? { ok: true, candidateIds: adj.map((u) => u.id) }
      : { ok: false, reason: '相邻无敌方' };
  },
  activeCast: (self: BattleUnit, targetIds: string[], engine: IBattleEngine) => {
    const target = engine.getUnit(targetIds[0]);
    if (!target) return { consumed: false };
    engine.emit(
      'skill_active_cast',
      { skillId: 'sr_lifeiyu.ultimate', targets: [target.id] },
      `灵剑·诛仙：${self.name} 对 ${target.name} 发动一击必杀`,
      { actorId: self.id, targetIds: [target.id], skillId: 'sr_lifeiyu.ultimate', severity: 'climax' },
    );
    return { consumed: true };
  },
  hooks: {
    // 攻击结算后的处决判定
    on_after_hit: ((ctx, engine) => {
      if (ctx.skillId !== 'sr_lifeiyu.ultimate') return;
      const target = engine.getUnit(ctx.defender.id);
      if (!target) return;
      if (target.isAlive && target.hp.current <= 3) {
        engine.emit(
          'unit_leave',
          { reason: 'execute', skillId: 'sr_lifeiyu.ultimate' },
          `灵剑·诛仙：${target.name} 处决！`,
          { actorId: ctx.attacker.id, targetIds: [target.id], skillId: 'sr_lifeiyu.ultimate', severity: 'climax' },
        );
        engine.changeStat(target.id, 'hp', -target.hp.current, {
          permanent: false,
          reason: '灵剑·诛仙 处决',
          skillId: 'sr_lifeiyu.ultimate',
        });
      } else if (target.isAlive) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'sr_lifeiyu.ultimate' },
          `灵剑·诛仙未处决——${target.name} 气血 ${target.hp.current} > 3`,
          { actorId: ctx.attacker.id, targetIds: [target.id], skillId: 'sr_lifeiyu.ultimate', severity: 'info' },
        );
      }
    }) as HookHandler,
  },
};
