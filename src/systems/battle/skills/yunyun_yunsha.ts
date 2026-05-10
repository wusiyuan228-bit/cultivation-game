/**
 * 【雲蕴 / 风之极·陨杀】通用SSR · 绝技（陨杀式攻击）
 * 策划原文：主动发动，与1名敌人进行修为判定，该判定结果同时作用于最多5名敌人
 * Q45 用户裁决：1 骰主（完整攻防）+ 最多 4 固定复制
 */
import type { SkillRegistration } from '../types';

export const skill_yunyun_yunsha: SkillRegistration = {
  id: 'ssr_yunyun.ult',
  name: '风之极·陨杀',
  description: '主动发动，与1敌判定，结果同时作用于最多5名敌人（1骰主+4固定复制）',
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
    const primary = engine.getUnit(targetIds[0]);
    if (!primary || !primary.isAlive) return { consumed: false };

    // MVP：用 self.atk × 2 作为主伤害的近似（等价 aSum-dSum 的期望）
    const damage0 = Math.max(1, self.atk.current * 2 - primary.atk.current);

    engine.emit(
      'skill_active_cast',
      { skillId: 'ssr_yunyun.ult', damage0 },
      `「风之极·陨杀」发动，以 ${primary.name} 为骰主，伤害 ${damage0}`,
      { actorId: self.id, targetIds: [primary.id], skillId: 'ssr_yunyun.ult', severity: 'climax' },
    );

    // 骰主：走完整伤害（此处直接扣血）
    engine.changeStat(primary.id, 'hp', -damage0, {
      permanent: false,
      reason: '风之极·陨杀·骰主',
      skillId: 'ssr_yunyun.ult',
    });
    engine.emit(
      'damage_applied',
      { skillId: 'ssr_yunyun.ult', damage: damage0, role: 'primary' },
      `${primary.name}（骰主）承受 ${damage0} 点伤害`,
      { actorId: self.id, targetIds: [primary.id], skillId: 'ssr_yunyun.ult', severity: 'highlight' },
    );

    // 额外目标最多 4 名，固定伤害 = damage0（不走防守骰、不触反伤 · Q45）
    const extras = engine
      .getEnemiesOf(self)
      .filter((u) => u.isAlive && u.id !== primary.id)
      .sort((a, b) => a.hp.current - b.hp.current)
      .slice(0, 4);
    for (const e of extras) {
      engine.changeStat(e.id, 'hp', -damage0, {
        permanent: false,
        floor: 0,
        reason: '风之极·陨杀·固定复制',
        skillId: 'ssr_yunyun.ult',
      });
      engine.emit(
        'damage_applied',
        { skillId: 'ssr_yunyun.ult', damage: damage0, role: 'extra' },
        `${e.name}（固定复制）承受 ${damage0} 点伤害`,
        { actorId: self.id, targetIds: [e.id], skillId: 'ssr_yunyun.ult', severity: 'highlight' },
      );
    }
    return { consumed: true };
  },
  hooks: {},
};
