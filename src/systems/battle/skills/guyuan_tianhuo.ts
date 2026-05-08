/**
 * 【古元 / 古族天火阵】绑定SSR · 战斗技能（光环）
 *
 * 策划原文：相邻所有友军修为+1（常驻光环，可突破修为上限）
 *
 * 契约登记：
 *   trigger  : passive（category=aura）
 *   effect   : aura_buff（stat_delta atk +1, breakCap=true）
 *   scope    : 相邻友军（曼哈顿 ≤1）
 *   裁决 Q30 ：aura 退出时 cap 突破同步回滚
 *   裁决 Q42 ：与宁风致七宝加持等其它 aura 可叠加（不同 sourceSkillId 独立计算）
 *
 * 实装说明：
 *   aura 型技能不挂持久 modifier，而是通过 on_damage_calc 钩子在"相邻友军进攻"时
 *   动态加 +1。等价于 modifier{kind:stat_delta, category:aura, duration:while_in_range}，
 *   但计算在 damage_calc 阶段即时执行，避免位置变化时要重新遍历所有 modifier。
 *
 *   本方案在所有友军（包括自己）进攻时检查：自己是否相邻？若相邻则 +1。
 *   为此该 handler 挂在"古元自身"，但 on_damage_calc 只对 ctx.attacker 派发——
 *   需要让所有友军都能感知到古元。方案：古元入场时为每个相邻友军挂 modifier。
 *
 *   阶段 E1 MVP 采用"古元身上挂 hook，在 attacker 是自己或相邻友军时 +1"
 *   但引擎 fireHook 仅按 attacker.skills / defender.skills 派发，所以必须改为
 *   "每个被 buff 的友军身上挂一个 stat_delta modifier"。
 *
 *   最终方案：
 *   - on_turn_start 时扫描相邻友军，给它们挂/更新 atk+1 aura modifier
 *   - on_turn_end 时驱散已离开相邻范围的 modifier
 *   - P5 · 新增 onPositionChange 钩子，任一单位移动后立即重算（解决 Q77）
 */
import type { Modifier, SkillRegistration, TurnHookHandler, BattleUnit, IBattleEngine } from '../types';
import { PRIORITY } from '../types';

const SKILL_ID = 'bssr_guyuan.battle';
const MOD_PREFIX = 'aura_guyuan_';

function isAdjacent(a: BattleUnit, b: BattleUnit): boolean {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col) <= 1;
}

function refreshAura(self: BattleUnit, engine: IBattleEngine): void {
  if (!self.isAlive) {
    // 自身已退场：驱散所有曾由此光环挂出的 modifier
    for (const u of engine.getAllUnits()) {
      const mods = engine.queryModifiers(u.id, 'stat_delta');
      mods
        .filter((m) => m.sourceSkillId === SKILL_ID)
        .forEach((m) => engine.detachModifier(m.id, '古元退场'));
    }
    return;
  }

  const alliesInRange = engine
    .getAlliesOf(self)
    .filter((u) => u.isAlive && u.id !== self.id && isAdjacent(self, u));
  const inRangeIds = new Set(alliesInRange.map((u) => u.id));

  // 1) 驱散不再相邻的 aura（Q30：cap 突破同步回滚）
  for (const u of engine.getAllUnits()) {
    const mods = engine
      .queryModifiers(u.id, 'stat_delta')
      .filter((m) => m.sourceSkillId === SKILL_ID);
    if (!inRangeIds.has(u.id)) {
      mods.forEach((m) => engine.detachModifier(m.id, '古元光环失效：离开相邻范围'));
    }
  }

  // 2) 为新进入/仍在范围内的友军挂/保持 aura（同 source 已存在则不重复挂）
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
      duration: { type: 'while_in_range', rangeFn: 'guyuan_adjacent' },
      priority: PRIORITY.AURA,
    };
    engine.attachModifier(mod);
    engine.emit(
      'modifier_applied',
      { skillId: SKILL_ID, mod: mod.kind, stat: 'atk', delta: +1 },
      `「古族天火阵」覆盖 ${ally.name}，修为 +1`,
      { actorId: self.id, targetIds: [ally.id], skillId: SKILL_ID, severity: 'info' },
    );
  }
}

export const skill_guyuan_tianhuo: SkillRegistration = {
  id: SKILL_ID,
  name: '古族天火阵',
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
    on_self_leave: ((ctx, engine) => {
      const self = engine.getUnit(ctx.defender.id);
      if (!self) return;
      refreshAura(self, engine);
    }) as import('../types').HookHandler,
  },
  // P5 · 位置变化实时重算（Q77）
  //   - 任何单位移动后被 store 回调，立即刷新光环覆盖范围
  //   - 使 hp-1 瘴气后的 dead 判定 / 位移技的相邻变化 / AI 走位 全部实时同步
  onPositionChange: (self, _movedUnitId, engine) => {
    if (!self.isAlive) return;
    refreshAura(self, engine);
  },
};
