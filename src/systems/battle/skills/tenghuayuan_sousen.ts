/**
 * 【藤化原 / 天鬼搜身】通用SR · 战斗技能（主动 / 每场1次）
 * 原文：行动轮开始时，可与任意 1 名角色交换位置
 *
 * 改造（2026-05-10）：
 *   原：on_turn_start 自动与最近敌方交换 —— 玩家无操作感
 *   现：作为主动战斗技能（isActive + targetSelector），玩家在自己行动轮内
 *       点击"战斗技能"按钮 → 进入瞄准 → 选任意角色（含友军/敌方）→ 完成交换
 *   每场战斗只能使用 1 次（由 store 层 battleSkillUsed 字段控管）
 *
 * Q69：被 disable_move 的角色仍可被强制交换（store 层不做移动力消耗）
 */
import type { SkillRegistration, BattleUnit, IBattleEngine } from '../types';

export const skill_tenghuayuan_sousen: SkillRegistration = {
  id: 'sr_tenghuayuan.battle',
  name: '天鬼搜身',
  description: '主动·与任意 1 名角色（含友军/敌方）交换位置；每场战斗仅可使用 1 次',
  kind: 'battle_skill',
  isActive: true,
  maxCasts: 1,
  // single_any_character：任意单位皆可点选（友军 / 敌方均可）
  targetSelector: { kind: 'single_any_character' },
  precheck: (self: BattleUnit, engine: IBattleEngine) => {
    const candidates = engine
      .getAllUnits()
      .filter((u) => u.isAlive && u.id !== self.id);
    if (candidates.length === 0) {
      return { ok: false, reason: '场上没有可交换的角色' };
    }
    return { ok: true, candidateIds: candidates.map((u) => u.id) };
  },
  // 实际位置交换由 store 层处理（因为 active handler 没有 setPosition 接口）
  // 这里只 emit 事件、消耗次数；store 层会根据 regId 'sr_tenghuayuan.battle' 路由到位置交换逻辑
  activeCast: (self: BattleUnit, targetIds: string[], engine: IBattleEngine) => {
    const target = engine.getUnit(targetIds[0]);
    if (!target) return { consumed: false };
    engine.emit(
      'skill_active_cast',
      { skillId: 'sr_tenghuayuan.battle', swap: true, a: self.id, b: target.id },
      `🫥 天鬼搜身：${self.name} ⇄ ${target.name} 位置互换`,
      {
        actorId: self.id,
        targetIds: [target.id],
        skillId: 'sr_tenghuayuan.battle',
        severity: 'highlight',
      },
    );
    return { consumed: true };
  },
  hooks: {},
};
