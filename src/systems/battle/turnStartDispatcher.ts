/**
 * Turn-Start Hook 派发器（2026-05-11 修复 · 关键 bug）
 *
 * 背景：
 *   3 套战斗 store（battleStore / s7bBattleStore / s7dBattleStore）的 BattleEngine
 *   adapter 中 fireTurnHook 全部为空函数 () => {}，且 store 在切换行动者时也从未
 *   调用任何 turn-start 派发逻辑 —— 导致 8+ 个 on_turn_start 主动/被动技能从未生效：
 *     · 云鹊子·癫狂·窃元
 *     · 谷鹤·炼药·聚元炉
 *     · 凝荣荣·七宝琉璃·加持
 *     · 凝峰志·七宝加持（aura）
 *     · 天云子·命格
 *     · 雅妃·迦南商会·补给
 *     · 黎沐婉·清思
 *     · 萧炎觉醒·帝炎·焚天
 *     · 古元·古族天火阵（aura）
 *
 * 本 helper 提供统一的 dispatcher，3 套 store 在切换到下一个行动者后调用一次
 * dispatchTurnStartHooks(actor, ctx) 即可让所有 on_turn_start hook 跑起来。
 *
 * 设计要点：
 *   1. 复用全局 globalModStore（与 store 持有的同一份），保证 modifier 一致
 *   2. 通过 ctx.callbacks 让 changeStat 直接 mutate store 内的 unit
 *   3. addLog 转发到 store 自己的 log 系统
 *   4. 保持只在 hook 派发期间存活的临时 adapter，跑完即释放
 */

import { SkillRegistry } from './skillRegistry';
import { globalModStore } from './e2Helpers';
import type {
  BattleUnit as EngineUnit,
  IBattleEngine,
  Modifier,
  ModifierKind,
} from './types';

/**
 * store 必须提供的最小 callback 集合
 * dispatcher 不直接 import store，避免循环依赖
 */
export interface TurnStartDispatchCtx {
  /** 把当前 store 全部存活/未存活单位映射成 EngineUnit 数组（dispatcher 每次都会重新调用以取最新值） */
  snapshotAllUnits: () => EngineUnit[];
  /** 修改某 unit 的属性，必须立即写回 store；返回实际变化量 */
  applyStatChange: (
    unitId: string,
    stat: 'hp' | 'atk' | 'mnd',
    delta: number,
    opts: {
      permanent: boolean;
      breakCap?: boolean;
      floor?: number;
      reason: string;
      skillId?: string;
    },
  ) => number;
  /** 写一条战报，type 可选：'system' | 'skill' | 'damage' | 'kill' | 'action' */
  addLog: (
    text: string,
    type?: 'system' | 'skill' | 'damage' | 'kill' | 'action',
  ) => void;
  /** 当前大回合数 */
  getRound: () => number;
  /** 全局 seq（用于 modifier id），可返回 0 让 modifier 用其他方式去重 */
  nextSeq?: () => number;
}

let _seqFallback = 0;

/**
 * 在某 unit 即将开始行动轮时调用，派发该 unit 身上所有 on_turn_start hook。
 *
 * 注意：调用时机是 store 已确定 actor、但行动尚未开始（即玩家/AI 还未选择移动/攻击）。
 * 这样保证 turn_start 类技能"在行动之前"完成结算（如焚天先扣血、聚元炉先挂 reroll）。
 */
export function dispatchTurnStartHooks(
  actorId: string,
  ctx: TurnStartDispatchCtx,
): void {
  const allUnits = ctx.snapshotAllUnits();
  const actor = allUnits.find((u) => u.id === actorId);
  if (!actor) return;
  if (!actor.isAlive) return;
  const skillIds = actor.skills ?? [];
  if (skillIds.length === 0) return;

  // 构造 minimal IBattleEngine adapter
  const adapter: Partial<IBattleEngine> = {
    getUnit: (id: string) => {
      const list = ctx.snapshotAllUnits();
      return list.find((x) => x.id === id);
    },
    getAllUnits: () => ctx.snapshotAllUnits(),
    getAlliesOf: (u: EngineUnit) => {
      const list = ctx.snapshotAllUnits();
      return list.filter(
        (x) => x.owner === u.owner && x.id !== u.id && x.isAlive,
      );
    },
    getEnemiesOf: (u: EngineUnit) => {
      const list = ctx.snapshotAllUnits();
      return list.filter((x) => x.owner !== u.owner && x.isAlive);
    },
    emit: (kind, _payload, narrative, opts) => {
      if (opts?.severity === 'debug') return;
      // 把战报种类映射到 store 的 BattleLog type
      const type: 'system' | 'skill' | 'damage' | 'kill' | 'action' =
        kind === 'damage_applied' ? 'damage'
        : kind === 'unit_leave' ? 'kill'
        : kind === 'skill_passive_trigger' ||
          kind === 'skill_effect_applied' ||
          kind === 'skill_effect_blocked' ||
          kind === 'skill_active_cast' ||
          kind === 'modifier_applied' ||
          kind === 'modifier_expired'
          ? 'skill'
          : 'system';
      ctx.addLog(narrative, type);
    },
    changeStat: (unitId, stat, delta, opts) => {
      return ctx.applyStatChange(unitId, stat, delta, opts);
    },
    attachModifier: (mod: Modifier) => {
      globalModStore.attach(mod);
    },
    queryModifiers: (unitId: string, kind: ModifierKind) =>
      globalModStore.query(unitId, kind) as Modifier[],
    detachModifier: (modId: string, _reason: string) => {
      globalModStore.detach(modId);
    },
    fireHook: () => {},
    fireTurnHook: () => {},
    getRound: () => ctx.getRound(),
    nextSeq: () => {
      if (ctx.nextSeq) return ctx.nextSeq();
      _seqFallback += 1;
      return _seqFallback;
    },
    getCurrentActorId: () => actorId,
    triggerAwakening: () => {},
  };

  // 派发该 unit 所有 on_turn_start hook
  for (const sid of skillIds) {
    const reg = SkillRegistry.get(sid);
    if (!reg) continue;
    const handler = reg.hooks.on_turn_start;
    if (!handler) continue;
    try {
      (handler as any)(
        {
          unit: actor,
          phase: 'start',
          round: ctx.getRound(),
          hookFiredSet: new Set<string>(),
        },
        adapter as IBattleEngine,
      );
    } catch (e) {
      console.error(
        `[turn-start-dispatch] hook on_turn_start of skill ${sid} (${actor.name}) threw:`,
        e,
      );
    }
  }
}

/**
 * 派发 on_turn_end hook（与 turn_start 对称）
 * 当前主要被 aura 类技能使用（古元·古族天火阵 / 凝峰志·七宝加持）
 */
export function dispatchTurnEndHooks(
  actorId: string,
  ctx: TurnStartDispatchCtx,
): void {
  const allUnits = ctx.snapshotAllUnits();
  const actor = allUnits.find((u) => u.id === actorId);
  if (!actor) return;
  if (!actor.isAlive) return;
  const skillIds = actor.skills ?? [];
  if (skillIds.length === 0) return;

  const adapter: Partial<IBattleEngine> = {
    getUnit: (id: string) =>
      ctx.snapshotAllUnits().find((x) => x.id === id),
    getAllUnits: () => ctx.snapshotAllUnits(),
    getAlliesOf: (u: EngineUnit) =>
      ctx.snapshotAllUnits().filter(
        (x) => x.owner === u.owner && x.id !== u.id && x.isAlive,
      ),
    getEnemiesOf: (u: EngineUnit) =>
      ctx.snapshotAllUnits().filter((x) => x.owner !== u.owner && x.isAlive),
    emit: (kind, _p, narrative, opts) => {
      if (opts?.severity === 'debug') return;
      const type: 'system' | 'skill' | 'damage' | 'kill' | 'action' =
        kind === 'damage_applied' ? 'damage'
        : kind === 'unit_leave' ? 'kill'
        : kind === 'modifier_applied' || kind === 'modifier_expired'
          ? 'skill'
          : 'system';
      ctx.addLog(narrative, type);
    },
    changeStat: (unitId, stat, delta, opts) =>
      ctx.applyStatChange(unitId, stat, delta, opts),
    attachModifier: (mod: Modifier) =>
      globalModStore.attach(mod),
    queryModifiers: (unitId: string, kind: ModifierKind) =>
      globalModStore.query(unitId, kind) as Modifier[],
    detachModifier: (modId: string) => globalModStore.detach(modId),
    fireHook: () => {},
    fireTurnHook: () => {},
    getRound: () => ctx.getRound(),
    nextSeq: () => {
      if (ctx.nextSeq) return ctx.nextSeq();
      _seqFallback += 1;
      return _seqFallback;
    },
    getCurrentActorId: () => actorId,
    triggerAwakening: () => {},
  };

  for (const sid of skillIds) {
    const reg = SkillRegistry.get(sid);
    if (!reg) continue;
    const handler = reg.hooks.on_turn_end;
    if (!handler) continue;
    try {
      (handler as any)(
        {
          unit: actor,
          phase: 'end',
          round: ctx.getRound(),
          hookFiredSet: new Set<string>(),
        },
        adapter as IBattleEngine,
      );
    } catch (e) {
      console.error(
        `[turn-end-dispatch] hook on_turn_end of skill ${sid} (${actor.name}) threw:`,
        e,
      );
    }
  }
}
