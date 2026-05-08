/**
 * 【拓森 / 古神之怒】通用SSR · 绝技
 * 策划原文：主动发动，对1名相邻敌人造成自身当前气血值的固定伤害
 */
import type { SkillRegistration } from '../types';

export const skill_tuosen_zhinu: SkillRegistration = {
  id: 'ssr_tuosen.ult',
  name: '古神之怒',
  description: '主动发动，对1名相邻敌人造成自身当前气血值的固定伤害',
  isActive: true,
  targetSelector: { kind: 'single_adjacent_enemy' },
  maxCasts: 1,
  precheck: (self, engine) => {
    const enemies = engine
      .getEnemiesOf(self)
      .filter(
        (u) => u.isAlive && Math.abs(u.row - self.row) + Math.abs(u.col - self.col) === 1,
      );
    if (enemies.length === 0) return { ok: false, reason: '相邻无敌方单位' };
    return { ok: true, candidateIds: enemies.map((u) => u.id) };
  },
  activeCast: (self, targetIds, engine) => {
    if (targetIds.length !== 1) return { consumed: false };
    const target = engine.getUnit(targetIds[0]);
    if (!target || !target.isAlive) return { consumed: false };
    const dmg = Math.max(1, self.hp.current);
    engine.emit(
      'skill_active_cast',
      { skillId: 'ssr_tuosen.ult', damage: dmg },
      `「古神之怒」发动，对 ${target.name} 倾尽 ${dmg} 点气血之怒`,
      { actorId: self.id, targetIds: [target.id], skillId: 'ssr_tuosen.ult', severity: 'climax' },
    );
    engine.changeStat(target.id, 'hp', -dmg, {
      permanent: false,
      reason: '古神之怒',
      skillId: 'ssr_tuosen.ult',
    });
    return { consumed: true };
  },
  hooks: {},
};
