/**
 * 【涵云芝 / 化形·镜像】通用SR · SR绝技
 * 原文：主动发动，选 1 名敌人，本大回合剩余时间内自身 atk 变为该敌人的 atk
 */
import type { SkillRegistration, BattleUnit, IBattleEngine, Modifier } from '../types';
import { PRIORITY } from '../types';

export const skill_hanyunzhi_jingxiang: SkillRegistration = {
  id: 'sr_hanyunzhi.ultimate',
  name: '化形·镜像',
  description: '选 1 名敌人，本大回合剩余时间内自身 atk 变为该敌人 atk（快照）',
  isActive: true,
  maxCasts: 1,
  targetSelector: { kind: 'single_any_enemy' },
  precheck: (self: BattleUnit, engine: IBattleEngine) => {
    const enemies = engine.getEnemiesOf(self).filter((u) => u.isAlive);
    return enemies.length > 0
      ? { ok: true, candidateIds: enemies.map((u) => u.id) }
      : { ok: false, reason: '场上无敌人' };
  },
  activeCast: (self: BattleUnit, targetIds: string[], engine: IBattleEngine) => {
    const target = engine.getUnit(targetIds[0]);
    if (!target) return { consumed: false };
    const snapshot = target.atk.current;
    const mod: Modifier = {
      id: `hjing_${self.id}_${engine.nextSeq()}`,
      sourceSkillId: 'sr_hanyunzhi.ultimate',
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
        ? `化形·镜像：atk ${self.atk.current} → ${snapshot}`
        : `化形·镜像发动——镜像后修为未上升`;
    engine.emit('skill_active_cast', { skillId: 'sr_hanyunzhi.ultimate' }, narrative, {
      actorId: self.id,
      targetIds: [target.id],
      skillId: 'sr_hanyunzhi.ultimate',
      severity: 'climax',
    });
    return { consumed: true };
  },
  hooks: {},
};
