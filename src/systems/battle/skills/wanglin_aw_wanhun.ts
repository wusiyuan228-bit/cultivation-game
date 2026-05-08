/**
 * 【仙尊·旺林 / 逆天·万魂幡】主角觉醒 · 战斗技能
 *
 * 契约登记：
 *   策划原文：击杀敌人后，本大回合可再行动1次
 *   trigger  : on_kill
 *   effect   : extra_action
 *   Q25 裁决：N=∞ + turn 内去重（同 turn 多杀仅 grant 1 次；
 *             跨 turn 链式无限递归；绝技击杀同样计入）
 *
 * 实装：
 *   - 在 on_kill 钩子触发时，检查 self.perTurn.extraActionsGranted
 *   - 若本 turn 尚未 grant 过，则 grant 1 次额外行动，标记 perTurn.extraActionsGranted += 1
 *   - 战报披露
 *
 * 说明：
 *   "本大回合剩余时间内可再行动1次"的具体调度逻辑由 store 层实现：
 *   store 在读到 extraActionsGranted > extraActionsConsumed 时，
 *   在 advanceAction() 阶段让该单位再次入队（acted 重置为 false）。
 *   阶段 C 先实现钩子侧的 grant；store 调度由后续补。
 */
import type { SkillRegistration, HookHandler } from '../types';

export const skill_wanglin_aw_wanhun: SkillRegistration = {
  id: 'hero_wanglin.awaken.battle',
  name: '逆天·万魂幡',
  description: '击杀敌人后，本大回合可再行动1次（同一行动轮内多次击杀只计一次）',
  hooks: {
    on_kill: ((ctx, engine) => {
      const self = ctx.attacker;
      // turn 内去重
      if (self.perTurn.extraActionsGranted >= 1) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'hero_wanglin.awaken.battle', reason: 'already_granted_this_turn' },
          `逆天·万魂幡：本行动轮已获过额外行动，不再重复`,
          { actorId: self.id, skillId: 'hero_wanglin.awaken.battle', severity: 'debug' },
        );
        return;
      }
      self.perTurn.extraActionsGranted += 1;
      engine.emit(
        'extra_action_granted',
        { unitId: self.id, source: 'hero_wanglin.awaken.battle' },
        `⚡ ${self.name}「逆天·万魂幡」触发！本大回合可再行动 1 次`,
        { actorId: self.id, skillId: 'hero_wanglin.awaken.battle', severity: 'climax' },
      );
    }) as HookHandler,
  },
};
