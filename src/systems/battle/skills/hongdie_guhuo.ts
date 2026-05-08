/**
 * 【红蝶 / 红蝶蛊惑】通用SR · SR绝技
 * 原文：主动发动，选 1 名敌人，使其下一个行动轮强制依次攻击其相邻的己方友军
 *
 * 实装说明（E2）：
 *   - activeCast 只做 emit skill_active_cast
 *   - 真实"标记目标为下一轮倒戈"由 store 层 performUltimate 分发（写 unit.charmedNextTurn=true）
 *   - advanceAction 在目标下一个行动轮开始时自动消费：
 *       按 id 字典序依次攻击其相邻友军，完毕后跳过本轮剩余操作
 */
import type { SkillRegistration, BattleUnit, IBattleEngine } from '../types';

export const skill_hongdie_guhuo: SkillRegistration = {
  id: 'sr_hongdie.ultimate',
  name: '红蝶蛊惑',
  description: '使目标下一行动轮强制依次攻击其相邻友军',
  isActive: true,
  maxCasts: 1,
  targetSelector: { kind: 'single_any_enemy' },
  precheck: (self: BattleUnit, engine: IBattleEngine) => {
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
      { skillId: 'sr_hongdie.ultimate' },
      `红蝶蛊惑：${target.name} 下一行动轮将倒戈攻击其友军`,
      { actorId: self.id, targetIds: [target.id], skillId: 'sr_hongdie.ultimate', severity: 'climax' },
    );
    return { consumed: true };
  },
  hooks: {},
};
