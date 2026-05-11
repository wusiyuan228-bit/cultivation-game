/**
 * 【凝蓉蓉 / 七宝琉璃·加持】通用SR · 战斗技能
 * 原文：行动轮开始时，可指定1名己方角色某项数值（修为/心境/气血）永久+1（受上限约束）
 * trigger: on_turn_start  effect: buff_any_stat  MVP：自动给全场 atk 最低友军+1（atk）
 * 2026-05-11：新增 interactiveOnTurnStart，玩家可手动选友军 + 选属性
 */
import type { SkillRegistration, TurnHookHandler } from '../types';

// 数值上限（与全局规则一致）
const ATK_CAP = 9;
const MND_CAP = 5;
// hp 受 hpCap 约束（每个单位独立）

export const skill_ningrongrong_qibao: SkillRegistration = {
  id: 'sr_ningrongrong.battle',
  name: '七宝琉璃·加持',
  description: '行动轮开始时，可指定 1 名己方某项数值永久 +1（受上限约束）',
  interactiveOnTurnStart: {
    promptTitle: '七宝琉璃·加持',
    promptBody: '行动开始前可为 1 名己方角色某项数值永久 +1（受上限约束）。是否发动？',
    collectChoices: (self, engine) => {
      const allies = engine.getAlliesOf(self).filter((u) => u.isAlive);
      // 自身也可作为目标
      const candidates = [self, ...allies];
      // 🔧 2026-05-12 修复：始终列出三种属性供玩家选择，apply 时再判断是否已达上限
      // 避免"目标只剩一个未满属性时弹窗自动跳过 stat 阶段"的问题
      return candidates
        .map((u) => ({
          targetId: u.id,
          stats: ['atk', 'mnd', 'hp'] as Array<'atk' | 'mnd' | 'hp'>,
        }))
        // 全部三种属性都到顶了的目标才剔除
        .filter((c) => {
          const u = candidates.find((x) => x.id === c.targetId)!;
          return (
            u.atk.current < ATK_CAP ||
            u.mnd.current < MND_CAP ||
            u.hp.current < u.hpCap
          );
        });
    },
    apply: (self, target, stat, engine) => {
      if (!stat) return;
      // 🔧 2026-05-12 修复：玩家选了某项已达上限的属性 → 友好提示并不施加
      const cap =
        stat === 'atk' ? ATK_CAP : stat === 'mnd' ? MND_CAP : target.hpCap;
      const cur =
        stat === 'atk'
          ? target.atk.current
          : stat === 'mnd'
            ? target.mnd.current
            : target.hp.current;
      const statLabel =
        stat === 'atk' ? '修为' : stat === 'mnd' ? '心境' : '气血';
      if (cur >= cap) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'sr_ningrongrong.battle' },
          `七宝琉璃·加持：${target.name} 的${statLabel}已达上限（${cur}/${cap}），技能未生效`,
          {
            actorId: self.id,
            targetIds: [target.id],
            skillId: 'sr_ningrongrong.battle',
            severity: 'info',
          },
        );
        return;
      }
      engine.changeStat(target.id, stat, +1, {
        permanent: stat !== 'hp', // hp 视为治疗（非永久结构），atk/mnd 永久
        breakCap: false,
        reason: '七宝琉璃·加持',
        skillId: 'sr_ningrongrong.battle',
      });
      engine.emit(
        'skill_passive_trigger',
        { skillId: 'sr_ningrongrong.battle', stat },
        `七宝琉璃·加持：${self.name} → ${target.name} ${statLabel} +1（玩家选择）`,
        {
          actorId: self.id,
          targetIds: [target.id],
          skillId: 'sr_ningrongrong.battle',
          severity: 'highlight',
        },
      );
    },
  },
  hooks: {
    on_turn_start: ((ctx, engine) => {
      const self = ctx.unit;
      if (!self.isAlive || !self.skills.includes('sr_ningrongrong.battle')) return;
      // MVP 自动：优先强化 atk 最低的未满上限友军 +1 atk
      const allies = engine.getAlliesOf(self).filter((u) => u.isAlive);
      const target = allies
        .filter((u) => u.atk.current < 9)
        .sort((a, b) => a.atk.current - b.atk.current)[0];
      if (!target) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'sr_ningrongrong.battle' },
          `七宝琉璃·加持待命——所有己方 atk 已达上限`,
          { actorId: self.id, skillId: 'sr_ningrongrong.battle', severity: 'info' },
        );
        return;
      }
      engine.emit(
        'skill_passive_trigger',
        { skillId: 'sr_ningrongrong.battle' },
        `七宝琉璃·加持：${target.name} atk+1（永久）（自动选择 · atk最低的未满上限友军）`,
        { actorId: self.id, targetIds: [target.id], skillId: 'sr_ningrongrong.battle', severity: 'highlight' },
      );
      engine.changeStat(target.id, 'atk', 1, {
        permanent: true,
        breakCap: false,
        reason: '七宝琉璃·加持',
        skillId: 'sr_ningrongrong.battle',
      });
    }) as TurnHookHandler,
  },
};
