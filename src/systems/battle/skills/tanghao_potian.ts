/**
 * 【塘昊 / 昊天九绝·破天】绑定SSR · 绝技
 *
 * 策划原文：主动发动，对1名相邻敌人进行攻击，本次额外投5颗骰子
 *
 * 契约登记：
 *   trigger  : active_once
 *   effect   : empowered_attack（extra_dice +5）
 *   target   : single_adjacent_enemy
 *
 * 实装说明（P1 · 2026-05-01 重做）：
 *   activeCast 只发出"意图"emit，真正的"+5骰"由 store 层 multiSegmentSkills 路由
 *   在调用 attack() 前将 attacker.atk 临时 +5 来等价模拟。
 *   这样走的是真实 resolveAttack 掷骰流程，期望伤害从固定 +5 改为 ~+5（3面骰 E(d)=1.0）
 *   更贴合策划原文"额外投5颗骰子"，也允许攻击触发其它 hook（如阴阳万解重投）。
 */
import type { SkillRegistration } from '../types';

export const skill_tanghao_potian: SkillRegistration = {
  id: 'bssr_tanghao.ult',
  name: '昊天九绝·破天',
  description: '主动发动，对1名相邻敌人进行攻击，本次额外投5颗骰子',
  isActive: true,
  targetSelector: { kind: 'single_adjacent_enemy' },
  maxCasts: 1,
  precheck: (self, engine) => {
    const enemies = engine
      .getEnemiesOf(self)
      .filter(
        (u) => u.isAlive && Math.abs(u.row - self.row) + Math.abs(u.col - self.col) === 1,
      );
    if (enemies.length === 0) {
      return { ok: false, reason: '相邻无敌方单位' };
    }
    return { ok: true, candidateIds: enemies.map((u) => u.id) };
  },
  activeCast: (self, targetIds, engine) => {
    if (targetIds.length !== 1) return { consumed: false };
    const target = engine.getUnit(targetIds[0]);
    if (!target || !target.isAlive) return { consumed: false };

    engine.emit(
      'skill_active_cast',
      { skillId: 'bssr_tanghao.ult', extraDice: 5 },
      `「昊天九绝·破天」发动，对 ${target.name} 发起额外5骰攻击`,
      { actorId: self.id, targetIds: [target.id], skillId: 'bssr_tanghao.ult', severity: 'climax' },
    );
    // 真正的攻击（含临时 atk+5）由 store 层通过 followUpAttack.diceOverride 路由展开
    return { consumed: true };
  },
  hooks: {},
  followUpAttack: {
    target: 'first_only',
    diceOverride: (self) => self.atk.current + 5,
  },
};
