/**
 * 【天蕴子 / 天运·因果倒转】通用SSR · 绝技
 * 策划原文：主动发动，选1名敌人，交换该敌人与相邻1名友军的当前气血值
 * Q53：仅换 currentHp，不动 maxHp；超出上限 clamp
 */
import type { SkillRegistration } from '../types';

export const skill_tianyunzi_yinguo: SkillRegistration = {
  id: 'ssr_tianyunzi.ult',
  name: '天运·因果倒转',
  description: '主动发动，选1名敌人，交换其与相邻1名友军的当前气血值',
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
    const enemy = engine.getUnit(targetIds[0]);
    if (!enemy || !enemy.isAlive) return { consumed: false };
    // 找 enemy 相邻的友军（自己 owner 的单位）
    const adjAllies = engine
      .getAllUnits()
      .filter(
        (u) =>
          u.isAlive &&
          u.owner === self.owner &&
          Math.abs(u.row - enemy.row) + Math.abs(u.col - enemy.col) === 1,
      );
    if (adjAllies.length === 0) {
      engine.emit(
        'skill_effect_blocked',
        { skillId: 'ssr_tianyunzi.ult', reason: 'no_adj_ally' },
        `「天运·因果倒转」发动失败——${enemy.name} 无相邻友军`,
        { actorId: self.id, skillId: 'ssr_tianyunzi.ult', severity: 'info' },
      );
      return { consumed: false };
    }
    // MVP：选 hp 最低的友军（最需要"借血"）
    adjAllies.sort((a, b) => a.hp.current - b.hp.current);
    const ally = adjAllies[0];
    const eHp = enemy.hp.current;
    const aHp = ally.hp.current;
    if (eHp === aHp) {
      engine.emit(
        'skill_effect_blocked',
        { skillId: 'ssr_tianyunzi.ult', reason: 'equal_hp' },
        `「天运·因果倒转」发动但双方气血相等，无变化`,
        { actorId: self.id, skillId: 'ssr_tianyunzi.ult', severity: 'info' },
      );
      return { consumed: true };
    }
    // 交换 current（clamp 到各自 hpCap）
    const newEnemyHp = Math.min(aHp, enemy.hpCap);
    const newAllyHp = Math.min(eHp, ally.hpCap);
    engine.changeStat(enemy.id, 'hp', newEnemyHp - eHp, {
      permanent: false,
      breakCap: false,
      reason: '因果倒转',
      skillId: 'ssr_tianyunzi.ult',
    });
    engine.changeStat(ally.id, 'hp', newAllyHp - aHp, {
      permanent: false,
      breakCap: false,
      reason: '因果倒转',
      skillId: 'ssr_tianyunzi.ult',
    });
    engine.emit(
      'skill_active_cast',
      { skillId: 'ssr_tianyunzi.ult', enemyOld: eHp, enemyNew: newEnemyHp, allyOld: aHp, allyNew: newAllyHp },
      `「天运·因果倒转」发动：${enemy.name} ${eHp}→${newEnemyHp}、${ally.name} ${aHp}→${newAllyHp}（友军自动选择 · hp最低的相邻友军）`,
      {
        actorId: self.id,
        targetIds: [enemy.id, ally.id],
        skillId: 'ssr_tianyunzi.ult',
        severity: 'climax',
      },
    );
    return { consumed: true };
  },
  hooks: {},
};
