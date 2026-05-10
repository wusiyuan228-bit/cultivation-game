/**
 * 【小舞儿 / 八段摔·断魂】主角本体 · 绝技（阶段 D · D1 扫尾实装）
 *
 * 契约登记（《战斗技能_全量登记表》§小舞儿）：
 *   策划原文：小舞儿主动退场时，选1名相邻敌人，造成小舞儿当前已损失气血值的固定伤害
 *   trigger  : on_self_sacrifice（并兼容 on_self_leave，由 Q8 裁决 ⊂ 关系）
 *   effect   : lost_hp_as_damage
 *   targetSelector: single_adjacent_enemy
 *   裁决：
 *     Q7（2026-05-01）: 主动退场不走 on_after_being_hit → 不触发尔铭反伤
 *     Q8（2026-05-01）: on_self_sacrifice ⊂ on_self_leave → 会触发塘散觉醒（十万年魂骨献祭）等 on_self_leave 监听
 *
 * 实装要点：
 *   - precheck：ultimateUsed=false / 存在相邻敌人（无则提示"自爆完成但无目标"）
 *   - activeCast：
 *     1) 计算 damage = maxHp - current.hp（若满血则 damage=0，仅消耗次数）
 *     2) 对选中敌人施加 hp -damage（非永久、skill_damage、无视封顶=不适用）
 *     3) self 直接退场（changeStat hp = -current.hp，标记 dead）—— "主动退场"语义
 *     4) 不触发 on_after_being_hit（由 performUltimate 的调用上下文保证）
 */
import type { SkillRegistration, TargetSelector } from '../types';

export const skill_xiaowu_duanhun: SkillRegistration = {
  id: 'hero_xiaowu.ultimate',
  name: '八段摔·断魂',
  description: '主动退场，选1名相邻敌人，造成自身已损失气血值的固定伤害',
  isActive: true,
  targetSelector: { kind: 'single_adjacent_enemy' } satisfies TargetSelector,
  maxCasts: 1,
  hooks: {},
  precheck: (self, engine) => {
    if (self.ultimateUsed) return { ok: false, reason: '绝技已使用' };
    const enemies = engine.getEnemiesOf(self);
    const adj = enemies.filter(
      (e: any) => Math.abs(e.row - self.row) + Math.abs(e.col - self.col) === 1,
    );
    if (adj.length === 0) {
      return { ok: false, reason: '八段摔·断魂发动失败——无相邻敌人' };
    }
    return { ok: true, candidateIds: adj.map((u: any) => u.id) };
  },
  activeCast: (self, targetIds, engine) => {
    const tid = targetIds[0];
    const target = tid ? engine.getUnit(tid) : undefined;
    if (!target || !target.isAlive) return { consumed: false };

    // 距离合法性
    if (Math.abs(target.row - self.row) + Math.abs(target.col - self.col) !== 1) {
      return { consumed: false };
    }

    const lostHp = Math.max(0, self.hp.initial - self.hp.current);

    // —— 披露技能发动 ——
    engine.emit(
      'skill_active_cast',
      { skillId: 'hero_xiaowu.ultimate', targetId: target.id, damage: lostHp },
      `💥 ${self.name} 发动【八段摔·断魂】主动退场 → ${target.name} 承受 ${lostHp} 点固伤`,
      {
        actorId: self.id,
        targetIds: [target.id],
        skillId: 'hero_xiaowu.ultimate',
        severity: 'climax',
      },
    );

    // —— 造成伤害 ——
    if (lostHp > 0) {
      engine.changeStat(target.id, 'hp', -lostHp, {
        permanent: false,
        reason: '八段摔·断魂',
        skillId: 'hero_xiaowu.ultimate',
      });
      engine.emit(
        'damage_applied',
        { targetId: target.id, value: lostHp, kind: 'skill_damage' },
        `   ${target.name} 承受 ${lostHp} 点固定伤害`,
        { targetIds: [target.id], skillId: 'hero_xiaowu.ultimate', severity: 'highlight' },
      );
    } else {
      engine.emit(
        'skill_effect_blocked',
        { skillId: 'hero_xiaowu.ultimate', reason: 'no_lost_hp' },
        `   ${self.name} 自爆但未造成伤害（已损失气血为 0）`,
        { targetIds: [target.id], skillId: 'hero_xiaowu.ultimate', severity: 'highlight' },
      );
    }

    // —— 主动退场（unit_leave reason=sacrifice）——
    // 用 changeStat 把 hp 清零，let store 的 checkAndTriggerAwakening 捕获
    // "塘散·小舞儿退场触发觉醒" 的 on_self_leave 监听
    engine.changeStat(self.id, 'hp', -self.hp.current, {
      permanent: false,
      reason: 'self_sacrifice',
      skillId: 'hero_xiaowu.ultimate',
    });
    engine.emit(
      'unit_leave',
      { unitId: self.id, reason: 'sacrifice' },
      `🏳 ${self.name} 主动退场（八段摔·断魂）`,
      { actorId: self.id, skillId: 'hero_xiaowu.ultimate', severity: 'climax' },
    );

    self.ultimateUsed = true;
    return { consumed: true };
  },
};
