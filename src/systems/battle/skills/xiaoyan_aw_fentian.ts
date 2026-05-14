/**
 * 【焚天·萧焱 / 帝炎·焚天】主角觉醒 · 战斗技能
 *
 * 契约登记：
 *   策划原文：对自己所在纵列包含自己的全部角色，各造成2点固定伤害（每个行动轮开始时结算）
 *   trigger  : on_turn_start（本体的每个行动轮开始）
 *   effect   : column_damage
 *   Q20 裁决：对自身也造成 2 点；自伤走 stat_change(self, hp, -2)，不触发 on_after_being_hit
 *
 * 实装：
 *   - 在 on_turn_start 钩子中，枚举同列所有存活单位（含自己）
 *   - 每个单位 changeStat(hp, -2)，伤害类型为 skill_damage（固伤，不触发反伤等）
 */
import type { SkillRegistration, TurnHookHandler } from '../types';

export const skill_xiaoyan_aw_fentian: SkillRegistration = {
  id: 'hero_xiaoyan.awaken.battle',
  name: '帝炎·焚天',
  description: '对自己所在纵列包含自己的全部角色，各造成2点固定伤害（每个行动轮开始时结算）',
  hooks: {
    on_turn_start: ((ctx, engine) => {
      const self = ctx.unit;
      const all = engine.getAllUnits();
      const column = all.filter((u) => u.isAlive && u.col === self.col);
      if (column.length === 0) return;

      engine.emit(
        'skill_passive_trigger',
        { skillId: 'hero_xiaoyan.awaken.battle' },
        `🔥 ${self.name}「帝炎·焚天」触发！第 ${self.col} 列承受灼烧`,
        { actorId: self.id, skillId: 'hero_xiaoyan.awaken.battle', severity: 'highlight' },
      );

      for (const u of column) {
        engine.changeStat(u.id, 'hp', -2, {
          permanent: false,
          reason: u.id === self.id ? '帝炎·焚天（自伤）' : '帝炎·焚天',
          skillId: 'hero_xiaoyan.awaken.battle',
        });
        engine.emit(
          'damage_applied',
          { targetId: u.id, value: 2, kind: 'skill_damage', source: '帝炎·焚天' },
          `   ${u.name} 承受 2 点固定伤害${u.id === self.id ? '（自身）' : ''}`,
          { targetIds: [u.id], skillId: 'hero_xiaoyan.awaken.battle', severity: 'highlight' },
        );
      }
    }) as TurnHookHandler,
  },
};
