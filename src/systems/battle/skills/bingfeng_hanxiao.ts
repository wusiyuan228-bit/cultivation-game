/**
 * 【冰凰 / 冰凰寒啸】通用SR · 战斗技能
 * 原文：被攻击时，可将 mnd+atk 相加来进行防守判定，若如此做则 hp-1
 * MVP：自动发动（hp>1 且 mnd+atk > 原防守 atk）
 */
import type { SkillRegistration, HookHandler } from '../types';

export const skill_bingfeng_hanxiao: SkillRegistration = {
  id: 'sr_bingfeng.battle',
  name: '冰凰寒啸',
  description: '被攻击时可扣 1 点 hp，用 mnd+atk 做防守骰数',
  hooks: {
    on_before_defend_roll: ((ctx, engine) => {
      const self = engine.getUnit(ctx.defender.id);
      if (!self || !self.skills.includes('sr_bingfeng.battle')) return;
      if (self.hp.current <= 1) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'sr_bingfeng.battle' },
          `冰凰寒啸无法启动——气血不足`,
          { actorId: self.id, skillId: 'sr_bingfeng.battle', severity: 'info' },
        );
        return;
      }
      const merged = self.mnd.current + self.atk.current;
      if (merged <= ctx.diceDefend) return;
      engine.changeStat(self.id, 'hp', -1, {
        permanent: false,
        reason: '冰凰寒啸 代价',
        skillId: 'sr_bingfeng.battle',
      });
      ctx.diceDefend = merged;
      engine.emit(
        'skill_passive_trigger',
        { skillId: 'sr_bingfeng.battle', defendDice: merged },
        `冰凰寒啸：防守骰数 → mnd+atk = ${merged}（自动发动 · 合并收益优于原防御）`,
        { actorId: self.id, skillId: 'sr_bingfeng.battle', severity: 'highlight' },
      );
    }) as HookHandler,
  },
};
