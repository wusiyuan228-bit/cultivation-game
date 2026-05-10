/**
 * 【子绫 / 双修合击】通用SSR · 绝技
 * 策划原文：主动发动，若寒立在场，对1名敌人进行攻击，骰子数=子绫修为+寒立修为
 * Q14：ignoreRange=true，无视距离与阻挡
 */
import type { SkillRegistration } from '../types';

export const skill_ziling_shuangxiu: SkillRegistration = {
  id: 'ssr_ziling.ult',
  name: '双修合击',
  description: '主动发动，若寒立在场，对1名敌人进行攻击（骰数=子绫+寒立修为，无视距离）',
  isActive: true,
  targetSelector: { kind: 'single_any_enemy' },
  maxCasts: 1,
  precheck: (self, engine) => {
    const hanli = engine
      .getAllUnits()
      .find(
        (u) =>
          u.isAlive &&
          u.owner === self.owner &&
          (u.id.includes('hanli') || u.name.includes('寒立')),
      );
    if (!hanli) return { ok: false, reason: '寒立不在场' };
    const enemies = engine.getEnemiesOf(self).filter((u) => u.isAlive);
    if (enemies.length === 0) return { ok: false, reason: '无敌方单位' };
    return { ok: true, candidateIds: enemies.map((u) => u.id) };
  },
  activeCast: (self, targetIds, engine) => {
    if (targetIds.length !== 1) return { consumed: false };
    const target = engine.getUnit(targetIds[0]);
    if (!target || !target.isAlive) return { consumed: false };
    const hanli = engine
      .getAllUnits()
      .find(
        (u) =>
          u.isAlive &&
          u.owner === self.owner &&
          (u.id.includes('hanli') || u.name.includes('寒立')),
      );
    if (!hanli) return { consumed: false };
    const totalAtk = self.atk.current + hanli.atk.current;
    const aSum = totalAtk * 3; // MVP：期望 3.5 约等于 3
    const dmg = Math.max(1, aSum - target.atk.current * 2);
    engine.emit(
      'skill_active_cast',
      { skillId: 'ssr_ziling.ult', diceCount: totalAtk, damage: dmg },
      `「双修合击」发动：子绫+寒立共 ${totalAtk} 颗骰，对 ${target.name} 造成 ${dmg} 伤害`,
      { actorId: self.id, targetIds: [target.id], skillId: 'ssr_ziling.ult', severity: 'climax' },
    );
    engine.changeStat(target.id, 'hp', -dmg, {
      permanent: false,
      reason: '双修合击',
      skillId: 'ssr_ziling.ult',
    });
    return { consumed: true };
  },
  hooks: {},
};
