/**
 * 【元瑶 / 阴灵蔽日】通用SR · SR绝技
 * 原文：元瑶退场时（主动/被动），可指定夺取对方 1 名非主角角色成为己方（继承所有状态）
 * Q65：绑定型 battle_skill 失效（不随新方主角）
 */
import type { SkillRegistration, HookHandler } from '../types';

export const skill_yuanyao_bini: SkillRegistration = {
  id: 'sr_yuanyao.ultimate',
  name: '阴灵蔽日',
  description: '退场时夺取 1 名敌方非主角卡为己方（Q65 绑定型技能失效）',
  hooks: {
    on_self_leave: ((ctx, engine) => {
      const self = engine.getUnit(ctx.attacker.id) ?? engine.getUnit(ctx.defender.id);
      if (!self) return;
      const targets = engine.getEnemiesOf(self).filter((e) => e.isAlive && !e.id.includes('hero_'));
      if (targets.length === 0) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'sr_yuanyao.ultimate' },
          `阴灵蔽日未生效——对方仅存主角卡`,
          { actorId: self.id, skillId: 'sr_yuanyao.ultimate', severity: 'info' },
        );
        return;
      }
      const target = targets[0]; // MVP：取第一个
      engine.emit(
        'ownership_change',
        { targetId: target.id, from: target.owner, to: self.owner },
        `阴灵蔽日：${target.name} 归属转变为 ${self.owner}（自动选择 · 第一个非主角敌方）`,
        { actorId: self.id, targetIds: [target.id], skillId: 'sr_yuanyao.ultimate', severity: 'climax' },
      );
      target.owner = self.owner;
    }) as HookHandler,
  },
};
