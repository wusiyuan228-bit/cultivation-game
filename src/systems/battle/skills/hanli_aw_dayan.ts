/**
 * 【剑虚·寒立 / 天罗万象·大衍决】主角觉醒 · 绝技
 *
 * 契约登记：
 *   策划原文：主动发动，选1名敌人，直接造成等同于自身修为值的固定伤害
 *   trigger  : active_once
 *   effect   : damage_by_atk
 */
import type { SkillRegistration, TargetSelector } from '../types';

export const skill_hanli_aw_dayan: SkillRegistration = {
  id: 'hero_hanli.awaken.ultimate',
  name: '天罗万象·大衍决',
  description: '主动发动，选1名敌人，直接造成等同于自身修为值的固定伤害',
  isActive: true,
  targetSelector: { kind: 'single_any_enemy' } satisfies TargetSelector,
  maxCasts: 1,
  hooks: {},
  precheck: (self, engine) => {
    if (self.ultimateUsed) return { ok: false, reason: '绝技已使用' };
    const enemies = engine.getEnemiesOf(self);
    if (enemies.length === 0) return { ok: false, reason: '场上无敌方单位' };
    return { ok: true, candidateIds: enemies.map((e) => e.id) };
  },
  activeCast: (self, targetIds, engine) => {
    const tid = targetIds[0];
    const target = tid ? engine.getUnit(tid) : undefined;
    if (!target || !target.isAlive) return { consumed: false };

    const damage = self.atk.current;
    engine.emit(
      'skill_active_cast',
      { skillId: 'hero_hanli.awaken.ultimate', damage, targetId: target.id },
      `⚔ ${self.name} 发动【天罗万象·大衍决】→ ${target.name} 承受 ${damage} 点固伤`,
      {
        actorId: self.id,
        targetIds: [target.id],
        skillId: 'hero_hanli.awaken.ultimate',
        severity: 'climax',
      },
    );
    engine.changeStat(target.id, 'hp', -damage, {
      permanent: false,
      reason: '天罗万象·大衍决',
      skillId: 'hero_hanli.awaken.ultimate',
    });
    engine.emit(
      'damage_applied',
      { targetId: target.id, value: damage, kind: 'skill_damage' },
      `   ${target.name} 承受 ${damage} 点固定伤害`,
      { targetIds: [target.id], skillId: 'hero_hanli.awaken.ultimate', severity: 'highlight' },
    );

    self.ultimateUsed = true;
    return { consumed: true };
  },
};
