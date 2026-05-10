/**
 * 【南宫宛 / 灵阵·归元】绑定SSR · 绝技（被动死亡触发）
 *
 * 策划原文：南宫宛死亡时（仅被动触发），可以使1名敌人的修为值归零（永久）
 *
 * 契约登记：
 *   trigger  : on_self_death（triggerMode=passive_only）
 *   effect   : set_stat（atk = 0, permanent）
 *   裁决 Q32 ：atk=0 时仍可攻击，aSum 固定=0 走最低伤害
 *
 * 实装说明：
 *   - 仅在被动死亡时触发（主动献祭不算）—— ctx.attackKind !== 'self_damage'
 *   - 目标选择：MVP 选 atk.current 最高的敌人（AI 默认策略）；人类玩家弹窗由 UI 接入
 */
import type { SkillRegistration, HookHandler } from '../types';

export const skill_nangongwan_guiyuan: SkillRegistration = {
  id: 'bssr_nangongwan.ult',
  name: '灵阵·归元',
  description: '南宫宛死亡时（仅被动触发），可以使1名敌人的修为值归零（永久）',
  hooks: {
    on_self_death: ((ctx, engine) => {
      const self = engine.getUnit(ctx.defender.id);
      if (!self) return;
      // 主动献祭不触发
      if (ctx.attackKind === 'self_damage') {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'bssr_nangongwan.ult', reason: 'sacrifice' },
          `「灵阵·归元」未触发——仅被动死亡触发`,
          { actorId: self.id, skillId: 'bssr_nangongwan.ult', severity: 'info' },
        );
        return;
      }
      const enemies = engine.getEnemiesOf(self).filter((u) => u.isAlive && u.atk.current > 0);
      if (enemies.length === 0) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'bssr_nangongwan.ult', reason: 'no_target' },
          `「灵阵·归元」未生效——无有效敌方可选`,
          { actorId: self.id, skillId: 'bssr_nangongwan.ult', severity: 'info' },
        );
        return;
      }
      // MVP：选 atk 最高者
      enemies.sort((a, b) => b.atk.current - a.atk.current || a.id.localeCompare(b.id));
      const target = enemies[0];
      engine.emit(
        'skill_passive_trigger',
        { skillId: 'bssr_nangongwan.ult' },
        `「灵阵·归元」触发，${target.name} 修为归零（自动选择 · atk最高的敌人）`,
        { actorId: self.id, targetIds: [target.id], skillId: 'bssr_nangongwan.ult', severity: 'climax' },
      );
      engine.changeStat(target.id, 'atk', -target.atk.current, {
        permanent: true,
        floor: 0,
        reason: '灵阵·归元',
        skillId: 'bssr_nangongwan.ult',
      });
    }) as HookHandler,
  },
};
