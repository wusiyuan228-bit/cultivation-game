/**
 * 【雲蕴 / 风之极·陨杀】通用SSR · 绝技（陨杀式攻击）
 * 策划原文：主动发动，与1名敌人进行修为判定，该判定结果同时作用于最多5名敌人
 * Q45 用户裁决：1 骰主（完整攻防）+ 最多 4 固定复制
 *
 * 修为判定规则（与普攻一致）：
 *   - 攻方掷 self.atk 颗 3 面骰（0/1/2）
 *   - 守方（骰主）掷 primary.atk 颗 3 面骰
 *   - damage0 = max(1, aSum - dSum)
 *   - 骰主与最多 4 名固定复制目标都承受 damage0
 *
 * 历史 Bug（2026-05-17 修复）：
 *   旧实现使用 `self.atk × 2 - primary.atk` 的期望值近似，
 *   导致战报里没有出现"双方掷骰"，伤害也是定值，
 *   与"修为判定"描述不符。本版改为真实掷骰。
 */
import type { SkillRegistration } from '../types';

/** 3 面骰（0/1/2）—— 与 resolveAttack 中的 rollDice 保持一致 */
function rollDice(count: number): number[] {
  const result: number[] = [];
  const n = Math.max(1, count);
  for (let i = 0; i < n; i++) result.push(Math.floor(Math.random() * 3));
  return result;
}

function sumArr(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0);
}

export const skill_yunyun_yunsha: SkillRegistration = {
  id: 'ssr_yunyun.ult',
  name: '风之极·陨杀',
  description: '主动发动，与1敌进行修为判定，结果同时作用于最多5名敌人（1骰主+4固定复制）',
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

    // ---- 修为判定（双方掷骰）----
    const diceAttack = Math.max(1, self.atk.current);
    const diceDefend = Math.max(1, primary.atk.current);
    const aDice = rollDice(diceAttack);
    const dDice = rollDice(diceDefend);
    const aSum = sumArr(aDice);
    const dSum = sumArr(dDice);
    const damage0 = Math.max(1, aSum - dSum);

    engine.emit(
      'skill_active_cast',
      {
        skillId: 'ssr_yunyun.ult',
        diceAttack,
        diceDefend,
        aDice,
        dDice,
        aSum,
        dSum,
        damage0,
      },
      `「风之极·陨杀」发动，以 ${primary.name} 为骰主，` +
        `${self.name} 投 ${diceAttack} 骰 [${aDice.join(',')}]=${aSum}，` +
        `${primary.name} 投 ${diceDefend} 骰 [${dDice.join(',')}]=${dSum}，` +
        `判定伤害 ${aSum} - ${dSum} = ${damage0}`,
      { actorId: self.id, targetIds: [primary.id], skillId: 'ssr_yunyun.ult', severity: 'climax' },
    );

    // 骰主：承受 damage0
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

    // 额外目标最多 4 名：复用同一判定结果（不再各自掷骰、不走防守骰、不触反伤 · Q45）
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
