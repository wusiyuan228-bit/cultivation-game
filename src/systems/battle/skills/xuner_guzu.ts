/**
 * 【薰儿 / 古族血脉·共鸣】主角本体 · 战斗技能
 *
 * 契约登记：
 *   策划原文：行动轮结束时，相邻1格内所有友军和自己回复1点气血（不可超过气血上限）
 *   trigger  : on_turn_end
 *   effect   : heal_adjacent_allies
 *   Q10 裁决：相邻 = 十字四向，曼哈顿距离=1，不含斜对角
 *
 * 实装：turn hook on_turn_end，遍历 engine.getAlliesOf(self) + self 自身，
 *       对距离 <=1（含 self）且未满血的友军 hp +1（不破上限）
 */
import type { SkillRegistration, TurnHookHandler, BattleUnit } from '../types';

function manhattan(a: BattleUnit, b: BattleUnit): number {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
}

export const skill_xuner_guzu: SkillRegistration = {
  id: 'hero_xuner.battle',
  name: '古族血脉·共鸣',
  description: '行动轮结束时，相邻1格内所有友军和自己回复1点气血（不可超过气血上限）',
  hooks: {
    on_turn_end: ((ctx, engine) => {
      const self = ctx.unit;
      const allies = engine.getAlliesOf(self);
      const candidates = [self, ...allies].filter((u) => manhattan(u, self) <= 1 && u.isAlive);
      const canHeal = candidates.filter((u) => u.hp.current < u.hpCap);

      if (canHeal.length === 0) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'hero_xuner.battle', reason: 'all_full_hp' },
          `「古族血脉·共鸣」待命——自身及相邻友军均已满血`,
          { actorId: self.id, skillId: 'hero_xuner.battle', severity: 'info' },
        );
        return;
      }

      engine.emit(
        'skill_passive_trigger',
        { skillId: 'hero_xuner.battle', healTargets: canHeal.map((u) => u.id) },
        `「古族血脉·共鸣」触发，相邻 ${canHeal.length} 名友军（含自身）回复气血`,
        {
          actorId: self.id,
          targetIds: canHeal.map((u) => u.id),
          skillId: 'hero_xuner.battle',
          severity: 'highlight',
        },
      );

      for (const u of canHeal) {
        engine.changeStat(u.id, 'hp', +1, {
          permanent: false, // 回血不改 base
          breakCap: false,
          reason: '古族血脉·共鸣',
          skillId: 'hero_xuner.battle',
        });
      }
      // 满血的友军单独标注
      const fullList = candidates.filter((u) => u.hp.current >= u.hpCap);
      for (const u of fullList) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'hero_xuner.battle', reason: 'target_full_hp', targetId: u.id },
          `${u.name} 已满血，未回复`,
          { targetIds: [u.id], skillId: 'hero_xuner.battle', severity: 'debug' },
        );
      }
    }) as TurnHookHandler,
  },
};
