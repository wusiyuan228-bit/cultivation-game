/**
 * 【司徒南 / 天逆珠·夺元】绑定SSR · 绝技
 *
 * 策划原文：主动发动，对1名敌人造成自身已损失气血值×2的固定伤害
 *
 * 契约登记：
 *   trigger  : active_once
 *   effect   : lost_hp_damage（(hpCap - hp.current) × 2）
 *   裁决 Q11② ：自身满血时强制拉到 1（最低伤害规则）
 */
import type { SkillRegistration } from '../types';

export const skill_situnan_duoyuan: SkillRegistration = {
  id: 'bssr_situnan.ult',
  name: '天逆珠·夺元',
  description: '主动发动，对1名敌人造成自身已损失气血值×2的固定伤害',
  isActive: true,
  targetSelector: { kind: 'single_any_enemy' },
  maxCasts: 1,
  precheck: (self, engine) => {
    const enemies = engine.getEnemiesOf(self).filter((u) => u.isAlive);
    if (enemies.length === 0) return { ok: false, reason: '场上无敌方' };
    return { ok: true, candidateIds: enemies.map((u) => u.id) };
  },
  activeCast: (self, targetIds, engine) => {
    if (targetIds.length !== 1) return { consumed: false };
    const target = engine.getUnit(targetIds[0]);
    if (!target || !target.isAlive) return { consumed: false };

    const lost = self.hpCap - self.hp.current;
    const damage = Math.max(1, lost * 2); // Q11② 最低 1

    engine.emit(
      'skill_active_cast',
      { skillId: 'bssr_situnan.ult', lostHp: lost, damage },
      `「天逆珠·夺元」发动，对 ${target.name} 倾注失血之怒`,
      { actorId: self.id, targetIds: [target.id], skillId: 'bssr_situnan.ult', severity: 'climax' },
    );
    engine.changeStat(target.id, 'hp', -damage, {
      permanent: false,
      reason: '天逆珠·夺元',
      skillId: 'bssr_situnan.ult',
    });
    engine.emit(
      'damage_applied',
      { skillId: 'bssr_situnan.ult', damage, kind: 'skill_damage' },
      `${target.name} 承受 ${damage} 点固定伤害`,
      { actorId: self.id, targetIds: [target.id], skillId: 'bssr_situnan.ult', severity: 'highlight' },
    );
    return { consumed: true };
  },
  hooks: {},
};
