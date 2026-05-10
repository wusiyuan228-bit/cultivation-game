/**
 * 【尔铭 / 泰坦陨击】绑定SSR · 绝技
 *
 * 策划原文：主动发动，对1名相邻敌人造成自身当前气血值的固定伤害
 *
 * 契约登记：
 *   trigger  : active_once
 *   effect   : current_hp_as_damage
 *   target   : single_adjacent_enemy
 *   damage   : self.hp.current（固定伤害，不走反伤链 · Q38 全局原则）
 */
import type { SkillRegistration } from '../types';

export const skill_erming_yunji: SkillRegistration = {
  id: 'bssr_erming.ult',
  name: '泰坦陨击',
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
    if (enemies.length === 0) {
      return { ok: false, reason: '相邻无敌方单位' };
    }
    return { ok: true, candidateIds: enemies.map((u) => u.id) };
  },
  activeCast: (self, targetIds, engine) => {
    if (targetIds.length !== 1) return { consumed: false };
    const target = engine.getUnit(targetIds[0]);
    if (!target || !target.isAlive) return { consumed: false };
    const damage = Math.max(1, self.hp.current); // Q11② 最低1
    engine.emit(
      'skill_active_cast',
      { skillId: 'bssr_erming.ult', damage },
      `「泰坦陨击」发动，以自身气血砸向 ${target.name}`,
      { actorId: self.id, targetIds: [target.id], skillId: 'bssr_erming.ult', severity: 'climax' },
    );
    engine.changeStat(target.id, 'hp', -damage, {
      permanent: false,
      reason: '泰坦陨击',
      skillId: 'bssr_erming.ult',
    });
    engine.emit(
      'damage_applied',
      { skillId: 'bssr_erming.ult', damage, kind: 'skill_damage' },
      `${target.name} 承受 ${damage} 点固定伤害`,
      { actorId: self.id, targetIds: [target.id], skillId: 'bssr_erming.ult', severity: 'highlight' },
    );
    return { consumed: true };
  },
  hooks: {},
};
