/**
 * 【涵云芝 / 化形散】通用SR · 战斗技能
 * 原文：场上任意 1 个角色死亡时，自身修为永久+1（可突破上限）
 * Q62：被薰儿庇护"复活"不触发
 */
import type { SkillRegistration, HookHandler } from '../types';

export const skill_hanyunzhi_huaxing: SkillRegistration = {
  id: 'sr_hanyunzhi.battle',
  name: '化形散',
  description: '场上任意角色死亡（真实退场）时，自身 atk 永久 +1（可破上限）',
  hooks: {
    on_any_death: ((ctx, engine) => {
      const self = engine.getUnit(ctx.defender.id); // handler 需再定位自己
      engine.getAllUnits().forEach((u) => {
        if (!u.isAlive || !u.skills.includes('sr_hanyunzhi.battle')) return;
        engine.emit(
          'skill_passive_trigger',
          { skillId: 'sr_hanyunzhi.battle' },
          `化形散：${u.name} atk+1（可破上限）`,
          { actorId: u.id, skillId: 'sr_hanyunzhi.battle', severity: 'highlight' },
        );
        engine.changeStat(u.id, 'atk', 1, {
          permanent: true,
          breakCap: true,
          reason: '化形散',
          skillId: 'sr_hanyunzhi.battle',
        });
      });
      void self; // 抑制未使用警告
    }) as HookHandler,
  },
};
