/**
 * 【马洪骏 / 凤凰笑田鸡】通用SR · 战斗技能
 * 原文：进攻时，可扣除自身 2 点气血，本次对目标额外造成 3 点固定伤害
 * MVP：hp ≥ 3 时自动发动（Q39 允许降至 1）
 */
import type { SkillRegistration, HookHandler } from '../types';

export const skill_mahongjun_tianji: SkillRegistration = {
  id: 'sr_mahongjun.battle',
  name: '凤凰笑田鸡',
  description: '进攻时可扣 2 点 hp，对目标额外造成 3 点固伤',
  hooks: {
    on_after_hit: ((ctx, engine) => {
      const self = engine.getUnit(ctx.attacker.id);
      const target = engine.getUnit(ctx.defender.id);
      if (!self || !target || !self.skills.includes('sr_mahongjun.battle')) return;
      if (ctx.attackKind !== 'basic') return;
      // 🔧 2026-05-16 绝技 followUp 攻击不触发本被动（避免 AOE 绝技每段都自残并叠加固伤）
      if (ctx.viaUltimate) return;
      if (self.hp.current < 3) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'sr_mahongjun.battle' },
          `凤凰笑田鸡无法启动——气血不足`,
          { actorId: self.id, skillId: 'sr_mahongjun.battle', severity: 'info' },
        );
        return;
      }
      engine.changeStat(self.id, 'hp', -2, {
        permanent: false,
        reason: '凤凰笑田鸡 代价',
        skillId: 'sr_mahongjun.battle',
      });
      engine.emit(
        'skill_passive_trigger',
        { skillId: 'sr_mahongjun.battle' },
        `凤凰笑田鸡：自爆式打击，追加 3 点固伤于 ${target.name}`,
        { actorId: self.id, targetIds: [target.id], skillId: 'sr_mahongjun.battle', severity: 'highlight' },
      );
      if (target.isAlive) {
        engine.changeStat(target.id, 'hp', -3, {
          permanent: false,
          reason: '凤凰笑田鸡 追加固伤',
          skillId: 'sr_mahongjun.battle',
        });
      }
    }) as HookHandler,
  },
};
