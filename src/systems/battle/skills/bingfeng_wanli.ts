/**
 * 【冰凰 / 冰封万里】通用SR · SR绝技
 * 原文：主动发动，本大回合剩余时间内，场上所有敌人 mnd-2（最低0）
 */
import type { SkillRegistration, BattleUnit, IBattleEngine, Modifier } from '../types';
import { PRIORITY } from '../types';

export const skill_bingfeng_wanli: SkillRegistration = {
  id: 'sr_bingfeng.ultimate',
  name: '冰封万里',
  description: '场上所有敌人 mnd-2（本大回合剩余时间内，最低 0）',
  isActive: true,
  maxCasts: 1,
  targetSelector: { kind: 'all_enemies' },
  precheck: (self: BattleUnit, engine: IBattleEngine) => {
    const enemies = engine.getEnemiesOf(self).filter((u) => u.isAlive);
    return enemies.length > 0
      ? { ok: true, candidateIds: enemies.map((u) => u.id) }
      : { ok: false, reason: '无敌方单位' };
  },
  activeCast: (self: BattleUnit, _tids: string[], engine: IBattleEngine) => {
    const enemies = engine.getEnemiesOf(self).filter((u) => u.isAlive);
    engine.emit(
      'skill_active_cast',
      { skillId: 'sr_bingfeng.ultimate', targets: enemies.map((u) => u.id) },
      `冰封万里：全体敌人 mnd-2（本大回合）`,
      { actorId: self.id, targetIds: enemies.map((u) => u.id), skillId: 'sr_bingfeng.ultimate', severity: 'climax' },
    );
    enemies.forEach((e) => {
      const mod: Modifier = {
        id: `bfwl_${e.id}_${engine.nextSeq()}`,
        sourceSkillId: 'sr_bingfeng.ultimate',
        sourceUnitId: self.id,
        category: 'temporal',
        targetUnitId: e.id,
        kind: 'stat_delta',
        payload: { stat: 'mnd', delta: -2, floor: 0 },
        duration: { type: 'round_remain' },
        priority: PRIORITY.TEMPORAL,
      };
      engine.attachModifier(mod);
    });
    return { consumed: true };
  },
  hooks: {},
};
