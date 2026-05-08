/**
 * 【仙尊·旺林 / 一念逆天】主角觉醒 · 绝技
 *
 * 契约登记：
 *   策划原文：主动发动，选1名敌人，直接将其气血设为1
 *   trigger  : active_once
 *   effect   : stat_set (hp=1)
 *
 * 穿透名单：属于"hp 赋值型"，能穿透古族祖灵结界（契约 §11 穿透名单）
 *           本阶段 C 古族结界尚未实装，无需特殊处理。
 */
import type { SkillRegistration, TargetSelector } from '../types';

export const skill_wanglin_aw_yinian: SkillRegistration = {
  id: 'hero_wanglin.awaken.ultimate',
  name: '一念逆天',
  description: '主动发动，选1名敌人，直接将其气血设为1',
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

    const oldHp = target.hp.current;
    const delta = 1 - oldHp;
    engine.emit(
      'skill_active_cast',
      { skillId: 'hero_wanglin.awaken.ultimate', targetId: target.id },
      `💀 ${self.name} 发动【一念逆天】→ ${target.name} 气血被直接设为 1`,
      {
        actorId: self.id,
        targetIds: [target.id],
        skillId: 'hero_wanglin.awaken.ultimate',
        severity: 'climax',
      },
    );
    // 用 changeStat 实现"设为1"：delta = 1 - oldHp；不突破 cap、floor=1
    engine.changeStat(target.id, 'hp', delta, {
      permanent: false,
      floor: 1,
      reason: '一念逆天',
      skillId: 'hero_wanglin.awaken.ultimate',
    });

    self.ultimateUsed = true;
    return { consumed: true };
  },
};
