/**
 * 【云雀子 / 仙遗二祖·万魂归一】通用SR · SR绝技
 * 原文：主动发动，消耗自身 3 点气血，对 1 名敌人造成 5 点固定伤害
 * Q39：hp=4 发动后剩 1 允许
 */
import type { SkillRegistration, BattleUnit, IBattleEngine } from '../types';

export const skill_yunquezi_wanhun: SkillRegistration = {
  id: 'sr_yunquezi.ultimate',
  name: '仙遗二祖·万魂归一',
  description: '消耗 3 hp，对 1 名敌人造成 5 点固定伤害',
  isActive: true,
  maxCasts: 1,
  targetSelector: { kind: 'single_any_enemy' },
  precheck: (self: BattleUnit, engine: IBattleEngine) => {
    if (self.hp.current <= 3) return { ok: false, reason: '气血不足' };
    const enemies = engine.getEnemiesOf(self).filter((u) => u.isAlive);
    return enemies.length > 0
      ? { ok: true, candidateIds: enemies.map((u) => u.id) }
      : { ok: false, reason: '场上无敌方' };
  },
  activeCast: (self: BattleUnit, targetIds: string[], engine: IBattleEngine) => {
    const target = engine.getUnit(targetIds[0]);
    if (!target) return { consumed: false };
    engine.emit(
      'skill_active_cast',
      { skillId: 'sr_yunquezi.ultimate' },
      `仙遗二祖·万魂归一：${self.name} 代价 3 hp，向 ${target.name} 送出 5 点固伤`,
      { actorId: self.id, targetIds: [target.id], skillId: 'sr_yunquezi.ultimate', severity: 'climax' },
    );
    engine.changeStat(self.id, 'hp', -3, {
      permanent: false,
      reason: '万魂归一 代价',
      skillId: 'sr_yunquezi.ultimate',
    });
    engine.changeStat(target.id, 'hp', -5, {
      permanent: false,
      reason: '万魂归一',
      skillId: 'sr_yunquezi.ultimate',
    });
    return { consumed: true };
  },
  hooks: {},
};
