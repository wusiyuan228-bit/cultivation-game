/**
 * 【焚天·萧焱 / 帝品火莲·毁灭】主角觉醒 · 绝技
 *
 * 契约登记：
 *   策划原文：主动发动，对全场所有敌人造成自身修为值一半（向上取整）的固定伤害
 *   trigger  : active_once
 *   effect   : global_damage_by_atk
 *
 * 实装：
 *   - precheck：场上有至少1名敌人 / ultimateUsed === false
 *   - activeCast：遍历所有敌人 changeStat(hp, -ceil(self.atk/2))
 */
import type { SkillRegistration, TargetSelector } from '../types';

export const skill_xiaoyan_aw_huiMie: SkillRegistration = {
  id: 'hero_xiaoyan.awaken.ultimate',
  name: '帝品火莲·毁灭',
  description: '主动发动，对全场所有敌人造成自身修为值一半（向上取整）的固定伤害',
  isActive: true,
  targetSelector: { kind: 'all_enemies' } satisfies TargetSelector,
  maxCasts: 1,
  hooks: {},
  precheck: (self, engine) => {
    if (self.ultimateUsed) return { ok: false, reason: '绝技已使用' };
    const enemies = engine.getEnemiesOf(self);
    if (enemies.length === 0) return { ok: false, reason: '场上无敌方单位' };
    return { ok: true, candidateIds: enemies.map((e) => e.id) };
  },
  activeCast: (self, _targetIds, engine) => {
    const damage = Math.ceil(self.atk.current / 2);
    engine.emit(
      'skill_active_cast',
      { skillId: 'hero_xiaoyan.awaken.ultimate', damage },
      `🔥 ${self.name} 发动【帝品火莲·毁灭】→ 全场敌人各受 ${damage} 点固伤`,
      { actorId: self.id, skillId: 'hero_xiaoyan.awaken.ultimate', severity: 'climax' },
    );

    const enemies = engine.getEnemiesOf(self);
    for (const e of enemies) {
      engine.changeStat(e.id, 'hp', -damage, {
        permanent: false,
        reason: '帝品火莲·毁灭',
        skillId: 'hero_xiaoyan.awaken.ultimate',
      });
      engine.emit(
        'damage_applied',
        { targetId: e.id, value: damage, kind: 'skill_damage' },
        `   ${e.name} 承受 ${damage} 点固定伤害`,
        { targetIds: [e.id], skillId: 'hero_xiaoyan.awaken.ultimate', severity: 'highlight' },
      );
    }

    self.ultimateUsed = true;
    return { consumed: true };
  },
};
