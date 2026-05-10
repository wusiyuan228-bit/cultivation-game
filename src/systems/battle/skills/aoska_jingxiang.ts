/**
 * 【傲思卡 / 镜像肠·复制】通用SR · SR绝技
 * 原文：主动发动，选 1 名友军，本大回合剩余时间内自身 atk 变为该友军 atk
 * Q57：复制瞬间快照，不同步后续变化
 */
import type { SkillRegistration, BattleUnit, IBattleEngine, Modifier } from '../types';
import { PRIORITY } from '../types';

export const skill_aoska_jingxiang: SkillRegistration = {
  id: 'sr_aoska.ultimate',
  name: '镜像肠·复制',
  description: '选 1 名友军，本大回合剩余时间内自身 atk 变为该友军 atk（快照）',
  isActive: true,
  maxCasts: 1,
  targetSelector: { kind: 'all_allies_incl_self' },
  precheck: (self: BattleUnit) => ({ ok: self.isAlive }),
  activeCast: (self: BattleUnit, targetIds: string[], engine: IBattleEngine) => {
    const target = engine.getUnit(targetIds[0]);
    if (!target) return { consumed: false };
    const snapshot = target.atk.current;
    const mod: Modifier = {
      id: `jxc_${self.id}_${engine.nextSeq()}`,
      sourceSkillId: 'sr_aoska.ultimate',
      sourceUnitId: self.id,
      category: 'temporal',
      targetUnitId: self.id,
      kind: 'stat_set',
      payload: { stat: 'atk', setTo: snapshot },
      duration: { type: 'round_remain' },
      priority: PRIORITY.TEMPORAL,
    };
    engine.attachModifier(mod);
    const narrative =
      snapshot > self.atk.current
        ? `镜像肠·复制：atk ${self.atk.current} → ${snapshot}`
        : `镜像肠·复制发动——镜像后修为未上升（${target.name} atk ${snapshot} ≤ 自身 ${self.atk.current}）`;
    engine.emit('skill_active_cast', { skillId: 'sr_aoska.ultimate' }, narrative, {
      actorId: self.id,
      targetIds: [target.id],
      skillId: 'sr_aoska.ultimate',
      severity: 'climax',
    });
    return { consumed: true };
  },
  hooks: {},
};
