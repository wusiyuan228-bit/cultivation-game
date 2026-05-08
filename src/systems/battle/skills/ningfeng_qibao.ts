/**
 * 【宁风致 / 七宝加持】通用SSR · 战斗技能（aura 光环）
 * 与古元·古族天火阵同构（见 guyuan_tianhuo.ts）
 * Q42：与古元光环可叠加（不同 source 独立挂 modifier）
 */
import type { Modifier, SkillRegistration, TurnHookHandler, BattleUnit, IBattleEngine } from '../types';
import { PRIORITY } from '../types';

const SKILL_ID = 'ssr_ningfengzhi.battle';
const MOD_PREFIX = 'aura_ningfeng_';

function isAdjacent(a: BattleUnit, b: BattleUnit): boolean {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col) <= 1;
}

function refreshAura(self: BattleUnit, engine: IBattleEngine): void {
  if (!self.isAlive) {
    for (const u of engine.getAllUnits()) {
      engine
        .queryModifiers(u.id, 'stat_delta')
        .filter((m) => m.sourceSkillId === SKILL_ID)
        .forEach((m) => engine.detachModifier(m.id, '宁风致退场'));
    }
    return;
  }
  const alliesInRange = engine
    .getAlliesOf(self)
    .filter((u) => u.isAlive && u.id !== self.id && isAdjacent(self, u));
  const inRangeIds = new Set(alliesInRange.map((u) => u.id));
  for (const u of engine.getAllUnits()) {
    const mods = engine
      .queryModifiers(u.id, 'stat_delta')
      .filter((m) => m.sourceSkillId === SKILL_ID);
    if (!inRangeIds.has(u.id)) {
      mods.forEach((m) => engine.detachModifier(m.id, '七宝加持失效：离开相邻范围'));
    }
  }
  for (const ally of alliesInRange) {
    const existing = engine
      .queryModifiers(ally.id, 'stat_delta')
      .filter((m) => m.sourceSkillId === SKILL_ID);
    if (existing.length > 0) continue;
    const mod: Modifier = {
      id: `${MOD_PREFIX}${self.id}->${ally.id}`,
      sourceSkillId: SKILL_ID,
      sourceUnitId: self.id,
      category: 'aura',
      targetUnitId: ally.id,
      kind: 'stat_delta',
      payload: { stat: 'atk', delta: +1, breakCap: true },
      duration: { type: 'while_in_range', rangeFn: 'ningfeng_adjacent' },
      priority: PRIORITY.AURA,
    };
    engine.attachModifier(mod);
    engine.emit(
      'modifier_applied',
      { skillId: SKILL_ID },
      `「七宝加持」覆盖 ${ally.name}，修为 +1`,
      { actorId: self.id, targetIds: [ally.id], skillId: SKILL_ID, severity: 'info' },
    );
  }
}

export const skill_ningfeng_qibao: SkillRegistration = {
  id: SKILL_ID,
  name: '七宝加持',
  description: '相邻所有友军修为+1（常驻光环，可突破修为上限）',
  hooks: {
    on_turn_start: ((tctx, engine) => {
      const self = engine.getUnit(tctx.unit.id);
      if (!self) return;
      refreshAura(self, engine);
    }) as TurnHookHandler,
    on_turn_end: ((tctx, engine) => {
      const self = engine.getUnit(tctx.unit.id);
      if (!self) return;
      refreshAura(self, engine);
    }) as TurnHookHandler,
  },
};
