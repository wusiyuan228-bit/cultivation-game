/**
 * 【碧碧栋 / 蛛皇真身】通用SSR · 绝技
 * 策划原文：主动发动，对1名敌人进行攻击，若本次攻方判定点数 > 对方当前修为值，则目标直接退场
 * 裁决 Q41：target.atk 取当前值（含光环）
 */
import type { SkillRegistration } from '../types';

export const skill_bibidong_zhenshen: SkillRegistration = {
  id: 'ssr_bibidong.ult',
  name: '蛛皇真身',
  description: '主动发动，对1名敌人进行攻击；若攻方判定点数 > 对方当前修为值，目标直接退场',
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

    // MVP 简化：aSum ≈ self.atk × 3（略低于 3.5×N 期望，避免 MVP 阶段稳处决 boss）
    const aSum = self.atk.current * 3;
    engine.emit(
      'skill_active_cast',
      { skillId: 'ssr_bibidong.ult', aSum, targetAtk: target.atk.current },
      `「蛛皇真身」发动，判定点数 ${aSum}，目标修为 ${target.atk.current}`,
      { actorId: self.id, targetIds: [target.id], skillId: 'ssr_bibidong.ult', severity: 'climax' },
    );
    if (aSum > target.atk.current) {
      engine.emit(
        'damage_applied',
        { skillId: 'ssr_bibidong.ult', execute: true },
        `${target.name} 被处决`,
        { actorId: self.id, targetIds: [target.id], skillId: 'ssr_bibidong.ult', severity: 'climax' },
      );
      engine.changeStat(target.id, 'hp', -target.hp.current, {
        permanent: false,
        reason: '蛛皇真身处决',
        skillId: 'ssr_bibidong.ult',
      });
    } else {
      engine.emit(
        'skill_effect_blocked',
        { skillId: 'ssr_bibidong.ult', reason: 'roll_not_exceed' },
        `「蛛皇真身」未处决——判定点数 ${aSum} 未超过 ${target.name} 修为 ${target.atk.current}`,
        { actorId: self.id, targetIds: [target.id], skillId: 'ssr_bibidong.ult', severity: 'info' },
      );
      // 即使未处决也算造成了攻击（按契约 normal_attack 常规伤害）
      const dmg = Math.max(1, aSum - target.atk.current * 2);
      engine.changeStat(target.id, 'hp', -dmg, {
        permanent: false,
        reason: '蛛皇真身',
        skillId: 'ssr_bibidong.ult',
      });
    }
    return { consumed: true };
  },
  hooks: {},
};
