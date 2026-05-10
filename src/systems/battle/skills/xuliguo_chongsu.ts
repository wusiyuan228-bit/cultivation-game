/**
 * 【徐立国 / 天罡元婴·重塑】通用SR · SR绝技
 * 原文：第一次死亡时，原地复活，以总数值 8 点重新分配 atk/mnd/hp
 * Q71：优先于薰儿庇护
 * MVP：自动 3/2/3 均衡分配；自动一次性触发
 */
import type { SkillRegistration, HookHandler } from '../types';

export const skill_xuliguo_chongsu: SkillRegistration = {
  id: 'sr_xuliguo.ultimate',
  name: '天罡元婴·重塑',
  description: '第一次死亡时原地复活，总数值 8 点重分配 atk/mnd/hp（MVP 自动 3/2/3）',
  hooks: {
    on_self_death: ((ctx, engine) => {
      const self = engine.getUnit(ctx.defender.id);
      if (!self || !self.skills.includes('sr_xuliguo.ultimate')) return;
      if (self.ultimateUsed) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'sr_xuliguo.ultimate' },
          `天罡元婴·重塑 已用尽（本场 1 次）`,
          { actorId: self.id, skillId: 'sr_xuliguo.ultimate', severity: 'info' },
        );
        return;
      }
      // 拦截死亡
      self.isAlive = true;
      self.hp.current = 3;
      self.atk.current = 3;
      self.mnd.current = 2;
      self.hpCap = Math.max(self.hpCap, 3);
      self.ultimateUsed = true;
      engine.emit(
        'revive',
        { skillId: 'sr_xuliguo.ultimate', hp: 3, atk: 3, mnd: 2 },
        `天罡元婴·重塑：${self.name} 原地复活（atk=3 mnd=2 hp=3）`,
        { actorId: self.id, skillId: 'sr_xuliguo.ultimate', severity: 'climax' },
      );
    }) as HookHandler,
  },
};
