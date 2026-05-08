/**
 * 【旺林 / 逆·天地崩】主角本体 · 绝技
 *
 * 契约登记：
 *   策划原文：主动发动，消耗自身一半气血（向上取整），对全场所有敌人造成等同于消耗气血值的固定伤害
 *   trigger  : active_once
 *   effect   : sacrifice_global_damage
 *   Q16 裁决 : A · 允许 hp=1 发动自毁；hp=0 时走 on_self_sacrifice + on_self_leave
 *
 * 实装：activeCast 中：
 *   1. 计算 cost = ceil(self.hp/2)
 *   2. self.hp -= cost（若 hp<=0 标记将触发 on_self_sacrifice）
 *   3. 对全场敌人各 -cost 点固定伤害（damageType=skill_damage，不走投骰）
 */
import type { SkillRegistration, TargetSelector } from '../types';

export const skill_wanglin_tiandi: SkillRegistration = {
  id: 'hero_wanglin.ultimate',
  name: '逆·天地崩',
  description: '主动发动，消耗自身一半气血（向上取整），对全场所有敌人造成等同于消耗气血值的固定伤害',
  isActive: true,
  targetSelector: { kind: 'all_enemies' } satisfies TargetSelector,
  maxCasts: 1,
  hooks: {},
  precheck: (self, engine) => {
    if (self.ultimateUsed) return { ok: false, reason: '绝技已使用' };
    if (self.hp.current <= 0) return { ok: false, reason: '已退场' };
    const enemies = engine.getEnemiesOf(self);
    if (enemies.length === 0) {
      return { ok: false, reason: '逆·天地崩发动失败——场上无敌人' };
    }
    return { ok: true, candidateIds: enemies.map((u) => u.id) };
  },
  activeCast: (self, _targetIds, engine) => {
    const cost = Math.ceil(self.hp.current / 2);
    engine.emit(
      'skill_active_cast',
      { skillId: 'hero_wanglin.ultimate', cost },
      `🌋 ${self.name} 发动【逆·天地崩】→ 自损 ${cost} 点气血，对全场敌人造成 ${cost} 点固定伤害`,
      {
        actorId: self.id,
        skillId: 'hero_wanglin.ultimate',
        severity: 'climax',
      },
    );
    // 1) 自损
    engine.changeStat(self.id, 'hp', -cost, {
      permanent: false,
      reason: '逆·天地崩·自损',
      skillId: 'hero_wanglin.ultimate',
    });
    // 2) 对全场敌人造成固定伤害
    const enemies = engine.getEnemiesOf(self);
    for (const e of enemies) {
      engine.changeStat(e.id, 'hp', -cost, {
        permanent: false,
        reason: '逆·天地崩',
        skillId: 'hero_wanglin.ultimate',
      });
      engine.emit(
        'damage_applied',
        { targetId: e.id, damage: cost, attackerId: self.id, damageKind: 'skill_damage' },
        `${e.name} 承受 ${cost} 点固定伤害（逆·天地崩）`,
        {
          actorId: self.id,
          targetIds: [e.id],
          skillId: 'hero_wanglin.ultimate',
          severity: 'highlight',
        },
      );
    }
    self.ultimateUsed = true;
    return { consumed: true };
  },
};
