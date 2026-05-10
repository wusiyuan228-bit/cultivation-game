/**
 * 【汪冬儿 / 金银双龙击】绑定SR · 绝技
 *
 * 策划原文：主动发动，对1名相邻敌人进行2次独立的攻击
 *
 * 契约登记：
 *   trigger  : active_once
 *   effect   : multi_attack（count=2，每段独立滚骰并独立触发 on_after_hit）
 *
 * 实装 MVP：
 *   MVP 版用固定伤害 = atk × 2 近似两次攻击（略偏乐观）；
 *   精确版需要调用 engine.performUltimate 并串行 2 次 resolveAttack —— 阶段 E3 精确化
 */
import type { SkillRegistration } from '../types';

export const skill_wangdonger_shuanglong: SkillRegistration = {
  id: 'bsr_wangdonger.ult',
  name: '金银双龙击',
  description: '主动发动，对1名相邻敌人进行2次独立的攻击',
  isActive: true,
  targetSelector: { kind: 'single_adjacent_enemy' },
  maxCasts: 1,
  precheck: (self, engine) => {
    const enemies = engine
      .getEnemiesOf(self)
      .filter(
        (u) => u.isAlive && Math.abs(u.row - self.row) + Math.abs(u.col - self.col) === 1,
      );
    if (enemies.length === 0) return { ok: false, reason: '相邻无敌方' };
    return { ok: true, candidateIds: enemies.map((u) => u.id) };
  },
  activeCast: (self, targetIds, engine) => {
    if (targetIds.length !== 1) return { consumed: false };
    const target = engine.getUnit(targetIds[0]);
    if (!target || !target.isAlive) return { consumed: false };

    engine.emit(
      'skill_active_cast',
      { skillId: 'bsr_wangdonger.ult' },
      `「金银双龙击」发动，对 ${target.name} 发起双段攻击`,
      { actorId: self.id, targetIds: [target.id], skillId: 'bsr_wangdonger.ult', severity: 'climax' },
    );

    // MVP 近似：每段伤害 = max(1, self.atk.current)
    for (let seg = 1; seg <= 2; seg += 1) {
      if (!target.isAlive) break;
      const dmg = Math.max(1, self.atk.current);
      engine.changeStat(target.id, 'hp', -dmg, {
        permanent: false,
        reason: `金银双龙击·第${seg}段`,
        skillId: 'bsr_wangdonger.ult',
      });
      engine.emit(
        'damage_applied',
        { skillId: 'bsr_wangdonger.ult', damage: dmg, segment: seg },
        `第 ${seg} 段：${target.name} 承受 ${dmg} 点伤害`,
        { actorId: self.id, targetIds: [target.id], skillId: 'bsr_wangdonger.ult', severity: 'highlight' },
      );
    }
    return { consumed: true };
  },
  hooks: {},
};
