/**
 * 【小医仙 / 毒体·蚀骨】绑定SR · 战斗技能
 *
 * 策划原文：进攻时，可对另外1名相邻敌人造成本次伤害的数值
 *           （溅射伤害，不再触发吞噬等后效）
 *
 * 契约登记：
 *   trigger  : on_after_hit
 *   effect   : splash_damage
 *   裁决 Q38 ：溅射不触发反伤等后效（全局原则）
 *   裁决 Q36 ：溅射产生的 damage 计入 didCauseAnyDamage
 */
import type { SkillRegistration, HookHandler } from '../types';

export const skill_xiaoyixian_dushigu: SkillRegistration = {
  id: 'bsr_xiaoyixian.battle',
  name: '毒体·蚀骨',
  description: '进攻时，可对另外1名相邻敌人造成本次伤害的数值（溅射，不触发后效）',
  hooks: {
    on_after_hit: ((ctx, engine) => {
      const attacker = engine.getUnit(ctx.attacker.id);
      const mainDefender = engine.getUnit(ctx.defender.id);
      if (!attacker || !mainDefender) return;

      // 计算本次主攻击最终伤害：从 calcLog 累计 delta（含正负）
      // 简化：使用 mainDefender 的 hp 下降量，若不可得则按 aSum-dSum 近似
      const mainDamage = Math.max(0, ctx.aSum - ctx.dSum);
      if (mainDamage <= 0) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'bsr_xiaoyixian.battle', reason: 'zero_damage' },
          `「毒体·蚀骨」触发但溅射伤害为 0`,
          { actorId: attacker.id, skillId: 'bsr_xiaoyixian.battle', severity: 'info' },
        );
        return;
      }
      // 找"另外1名 attacker 相邻的敌人"
      const splashTargets = engine
        .getEnemiesOf(attacker)
        .filter(
          (u) =>
            u.isAlive &&
            u.id !== mainDefender.id &&
            Math.abs(u.row - attacker.row) + Math.abs(u.col - attacker.col) === 1,
        );
      if (splashTargets.length === 0) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'bsr_xiaoyixian.battle', reason: 'no_other_adj' },
          `「毒体·蚀骨」未触发——无其它相邻敌方可溅射`,
          { actorId: attacker.id, skillId: 'bsr_xiaoyixian.battle', severity: 'info' },
        );
        return;
      }
      // MVP：选 hp 最低的目标
      splashTargets.sort((a, b) => a.hp.current - b.hp.current);
      const splashTarget = splashTargets[0];
      engine.emit(
        'skill_passive_trigger',
        { skillId: 'bsr_xiaoyixian.battle', splash: mainDamage },
        `「毒体·蚀骨」触发，溅射 ${mainDamage} 点伤害至 ${splashTarget.name}（自动选择 · hp最低的相邻敌）`,
        { actorId: attacker.id, targetIds: [splashTarget.id], skillId: 'bsr_xiaoyixian.battle', severity: 'highlight' },
      );
      engine.changeStat(splashTarget.id, 'hp', -mainDamage, {
        permanent: false,
        reason: '毒体·蚀骨·溅射',
        skillId: 'bsr_xiaoyixian.battle',
      });
      // Q38：溅射不再走 fireHook(on_after_being_hit)，即不触发反伤/吞噬
    }) as HookHandler,
  },
};
