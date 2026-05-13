/**
 * 【傲思卡 / 大香肠】通用SR · 战斗技能
 * 原文：行动轮结束时，可指定1名友军气血+2（不可超上限）
 *
 * 2026-05-13 修复：
 *   - 之前实装只查 getAlliesOf（不含 self）导致傲思卡自己缺血但队友满血时
 *     技能走"全员满血"待命分支 → 现改为 [self, ...engine.getAlliesOf(self)]
 *   - 新增 interactiveOnTurnEnd：玩家控制时弹窗让玩家手动选友军（含自身），
 *     AI 控制时走 hooks.on_turn_end 自动选"最缺血友军"逻辑（向后兼容）
 */
import type { SkillRegistration, TurnHookHandler } from '../types';

export const skill_aoska_xiangchang: SkillRegistration = {
  id: 'sr_aoska.battle',
  name: '大香肠',
  description: '行动轮结束时，选 1 名友军（含自身）气血 +2（不可超上限）',
  interactiveOnTurnEnd: {
    promptTitle: '大香肠',
    promptBody: '行动轮结束前可为 1 名友军（含自身）回复 2 点气血（不可超上限）。是否发动？',
    collectChoices: (self, engine) => {
      const candidates = [self, ...engine.getAlliesOf(self)].filter(
        (u) => u.isAlive && u.hp.current < u.hpCap,
      );
      return candidates.map((u) => ({ targetId: u.id }));
    },
    apply: (self, target, _stat, engine) => {
      if (!target.isAlive) return;
      if (target.hp.current >= target.hpCap) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'sr_aoska.battle' },
          `大香肠：${target.name} 已满血，技能未生效`,
          { actorId: self.id, targetIds: [target.id], skillId: 'sr_aoska.battle', severity: 'info' },
        );
        return;
      }
      engine.changeStat(target.id, 'hp', 2, {
        permanent: false,
        breakCap: false,
        reason: '大香肠',
        skillId: 'sr_aoska.battle',
      });
      engine.emit(
        'skill_passive_trigger',
        { skillId: 'sr_aoska.battle' },
        `大香肠：${self.name} → ${target.name} 气血 +2（玩家选择）`,
        { actorId: self.id, targetIds: [target.id], skillId: 'sr_aoska.battle', severity: 'highlight' },
      );
    },
  },
  hooks: {
    on_turn_end: ((ctx, engine) => {
      const self = ctx.unit;
      if (!self.isAlive || !self.skills.includes('sr_aoska.battle')) return;
      const allies = [self, ...engine.getAlliesOf(self)]
        .filter((u) => u.isAlive && u.hp.current < u.hpCap);
      if (allies.length === 0) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'sr_aoska.battle' },
          `大香肠待命——全员满血`,
          { actorId: self.id, skillId: 'sr_aoska.battle', severity: 'info' },
        );
        return;
      }
      // 最缺血的（hp 缺失比例最高）—— 仅 AI 控制走此自动逻辑
      const target = allies.sort((a, b) => a.hp.current / a.hpCap - b.hp.current / b.hpCap)[0];
      engine.emit(
        'skill_passive_trigger',
        { skillId: 'sr_aoska.battle' },
        `大香肠：为 ${target.name} 回复 2 点气血（自动选择 · 最缺血的友军${target.id === self.id ? '·自己' : ''}）`,
        { actorId: self.id, targetIds: [target.id], skillId: 'sr_aoska.battle', severity: 'highlight' },
      );
      engine.changeStat(target.id, 'hp', 2, {
        permanent: false,
        breakCap: false,
        reason: '大香肠',
        skillId: 'sr_aoska.battle',
      });
    }) as TurnHookHandler,
  },
};
