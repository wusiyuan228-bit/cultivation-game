/**
 * 【云鹊子 / 癫狂·窃元】通用SR · 战斗技能
 * 原文：行动轮开始时，可指定 1 名相邻敌人某项数值 -1（永久，最低 1；hp -1 不击杀）
 * MVP：自动选最近相邻敌，优先降 atk（AI/老路径）
 * 2026-05-11：新增 interactiveOnTurnStart，让玩家可手动选目标 + 选属性
 */
import type { SkillRegistration, TurnHookHandler } from '../types';

export const skill_yunquezi_qieyuan: SkillRegistration = {
  id: 'sr_yunquezi.battle',
  name: '癫狂·窃元',
  description: '行动轮开始时，相邻敌 1 名指定属性 -1（永久，最低 1；hp 不致死）',
  // ───────── 玩家弹窗元数据 ─────────
  interactiveOnTurnStart: {
    promptTitle: '癫狂·窃元',
    promptBody: '行动开始前可削弱 1 名相邻敌人某项数值（永久 -1，最低为 1；hp 不致死）。是否发动？',
    collectChoices: (self, engine) => {
      const adj = engine
        .getEnemiesOf(self)
        .filter(
          (u) =>
            u.isAlive &&
            Math.abs(u.row - self.row) + Math.abs(u.col - self.col) === 1,
        );
      return adj
        .map((u) => {
          const stats: Array<'atk' | 'mnd' | 'hp'> = [];
          if (u.atk.current > 1) stats.push('atk');
          if (u.mnd.current > 1) stats.push('mnd');
          if (u.hp.current > 1) stats.push('hp');
          if (stats.length === 0) return null;
          return { targetId: u.id, stats };
        })
        .filter((x): x is { targetId: string; stats: Array<'atk' | 'mnd' | 'hp'> } => x !== null);
    },
    apply: (self, target, stat, engine) => {
      if (!stat) return;
      const reasonText =
        stat === 'hp' ? '癫狂·窃元（不致死）' : '癫狂·窃元';
      engine.changeStat(target.id, stat, -1, {
        permanent: true,
        floor: 1,
        reason: reasonText,
        skillId: 'sr_yunquezi.battle',
      });
      const statLabel =
        stat === 'atk' ? '修为' : stat === 'mnd' ? '心境' : '气血';
      engine.emit(
        'skill_passive_trigger',
        { skillId: 'sr_yunquezi.battle', stat },
        `癫狂·窃元：${self.name} → ${target.name} ${statLabel} -1（玩家选择）`,
        {
          actorId: self.id,
          targetIds: [target.id],
          skillId: 'sr_yunquezi.battle',
          severity: 'highlight',
        },
      );
    },
  },
  hooks: {
    on_turn_start: ((ctx, engine) => {
      const self = ctx.unit;
      if (!self.isAlive || !self.skills.includes('sr_yunquezi.battle')) return;
      const target = engine
        .getEnemiesOf(self)
        .find((u) => u.isAlive && Math.abs(u.row - self.row) + Math.abs(u.col - self.col) === 1);
      if (!target) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'sr_yunquezi.battle' },
          `癫狂·窃元未触发——相邻无敌方`,
          { actorId: self.id, skillId: 'sr_yunquezi.battle', severity: 'info' },
        );
        return;
      }
      // MVP：优先 atk（威胁最大）
      if (target.atk.current > 1) {
        engine.changeStat(target.id, 'atk', -1, {
          permanent: true,
          floor: 1,
          reason: '癫狂·窃元',
          skillId: 'sr_yunquezi.battle',
        });
        engine.emit(
          'skill_passive_trigger',
          { skillId: 'sr_yunquezi.battle', stat: 'atk' },
          `癫狂·窃元：${target.name} atk-1（自动选择 · 相邻敌，优先削修为）`,
          { actorId: self.id, targetIds: [target.id], skillId: 'sr_yunquezi.battle', severity: 'highlight' },
        );
      } else if (target.mnd.current > 1) {
        engine.changeStat(target.id, 'mnd', -1, {
          permanent: true,
          floor: 1,
          reason: '癫狂·窃元',
          skillId: 'sr_yunquezi.battle',
        });
      } else if (target.hp.current > 1) {
        engine.changeStat(target.id, 'hp', -1, {
          permanent: true,
          floor: 1,
          reason: '癫狂·窃元（不致死）',
          skillId: 'sr_yunquezi.battle',
        });
      } else {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'sr_yunquezi.battle' },
          `${target.name} 所有属性均已到最低，癫狂·窃元无可削弱项`,
          { actorId: self.id, targetIds: [target.id], skillId: 'sr_yunquezi.battle', severity: 'info' },
        );
      }
    }) as TurnHookHandler,
  },
};
