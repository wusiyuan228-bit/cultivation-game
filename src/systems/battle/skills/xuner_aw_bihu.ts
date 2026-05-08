/**
 * 【斗帝血脉·薰儿 / 斗帝血脉·庇护】主角觉醒 · 战斗技能
 *
 * 契约登记：
 *   策划原文：己方角色被击杀时，薰儿可使其保留1点气血存活（每场限2次）
 *   trigger  : on_any_ally_death（拦截式）
 *   effect   : prevent_death
 *   Q21 裁决：弹窗询问玩家（人类）/ AI 自动抉择
 *   Q22 裁决：对薰儿自己死亡同样生效
 *
 * 实装：
 *   - 在 on_any_ally_death 钩子中拦截：若剩余次数>0，将 target hp 设为 1、修正 isAlive
 *   - 次数通过薰儿自身挂载的 prevent_death_counter modifier 记录
 *
 * 阶段 C 简化：
 *   - 不做弹窗；AI 侧自动抉择"总是发动"（符合 AI 贪婪策略）
 *   - 玩家侧也默认"总是发动"；后续阶段 D 实装 UI 弹窗时再加"拒绝发动"选项
 *
 * 关键细节：
 *   - 这个钩子的触发时机是"ally 即将死亡但尚未完全 unit_leave"。
 *     store 层的 attack() 流程在 Phase 6 hook 触发完之后、Phase 7 unit_leave 之前
 *     会调用 on_any_ally_death 广播钩子。阶段 C S7B store 尚未实现广播侧；
 *     改造在后续 store 修改中补全。
 */
import type { SkillRegistration, HookHandler, Modifier } from '../types';
import { PRIORITY } from '../types';
import { genModifierId } from '../modifierSystem';

const BIHU_COUNTER_KIND = 'prevent_death_counter' as const;
const BIHU_LIMIT = 2;

export const skill_xuner_aw_bihu: SkillRegistration = {
  id: 'hero_xuner.awaken.battle',
  name: '斗帝血脉·庇护',
  description: '己方角色被击杀时，薰儿可使其保留1点气血存活（每场限2次）',
  autoModifiers: (self) => {
    // 觉醒上场时挂一个"庇护计数器"modifier，初始剩余 2 次
    const mod: Modifier = {
      id: genModifierId('hero_xuner.awaken.battle'),
      sourceSkillId: 'hero_xuner.awaken.battle',
      sourceUnitId: self.id,
      category: 'permanent',
      targetUnitId: self.id,
      kind: BIHU_COUNTER_KIND,
      payload: { remaining: BIHU_LIMIT },
      duration: { type: 'permanent_in_battle' },
      priority: PRIORITY.PREVENT_DEATH,
    };
    return [mod];
  },
  hooks: {
    on_any_ally_death: ((ctx, engine) => {
      const self = ctx.attacker; // 注意：广播钩子时 ctx.attacker 由 engine 填成 "监听者"（薰儿）
      // ctx.defender 是即将死亡的友军（含薰儿自己，Q22）
      const dying = ctx.defender;
      if (!dying || !self.isAlive) return;

      // 检查次数
      const counters = engine.queryModifiers(self.id, BIHU_COUNTER_KIND);
      const counter = counters[0];
      if (!counter) return;
      const remaining = (counter.payload.remaining as number) ?? 0;
      if (remaining <= 0) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'hero_xuner.awaken.battle', reason: 'no_counter' },
          `斗帝血脉·庇护次数已用尽（本场 ${BIHU_LIMIT} 次）`,
          { actorId: self.id, skillId: 'hero_xuner.awaken.battle', severity: 'info' },
        );
        return;
      }

      // 阶段 C 简化：自动发动（不弹窗）
      // 将 dying.hp 提升到 1
      const delta = 1 - dying.hp.current;
      engine.changeStat(dying.id, 'hp', delta, {
        permanent: false,
        floor: 1,
        reason: '斗帝血脉·庇护',
        skillId: 'hero_xuner.awaken.battle',
      });
      dying.isAlive = true;
      counter.payload.remaining = remaining - 1;

      engine.emit(
        'skill_passive_trigger',
        {
          skillId: 'hero_xuner.awaken.battle',
          target: dying.id,
          newHp: 1,
          remainingAfter: remaining - 1,
        },
        `🛡 ${self.name}「斗帝血脉·庇护」拦截死亡！${dying.name} 保留 1 点气血存活（剩余 ${remaining - 1} 次）`,
        {
          actorId: self.id,
          targetIds: [dying.id],
          skillId: 'hero_xuner.awaken.battle',
          severity: 'climax',
        },
      );
    }) as HookHandler,
  },
};

export const BIHU_LIMIT_CONST = BIHU_LIMIT;
