/**
 * Modifier 系统（契约 §2.2 + §2.3 + §5.1）
 *
 * 职责：
 *   1. 管理所有单位身上的 Modifier 列表
 *   2. 提供挂载 / 驱散 / 查询 / 按 phase 排序调度接口
 *   3. 处理生命周期到期（this_attack / this_turn / next_turn / round_remain / use_count）
 *   4. emit modifier_applied / modifier_expired / modifier_consumed 战报
 *
 * 设计决策：
 *   - Modifier 单独存储在本类中（map: unitId → Modifier[]），不塞进 BattleUnit 本体
 *     避免 BattleUnit 因 modifier 变更而频繁 immutable 替换导致 Zustand 下游全量更新
 *   - 同 kind 同 sourceSkill 同 target 的 modifier 如何叠加：默认允许共存（覆盖问题由 priority 解决）
 *   - 由 caller 负责通过 priority 决定结算顺序（§5.1 序号 ①②③…⑨）
 */

import type {
  Modifier,
  ModifierKind,
  IBattleEngine,
} from './types';

/** 全局自增 id 生成器 */
let _modInstanceCounter = 0;
export function genModifierId(skillId: string): string {
  _modInstanceCounter += 1;
  return `${skillId}#${_modInstanceCounter}`;
}

export class ModifierStore {
  /** 每个单位身上挂的 modifier 列表 */
  private byUnit: Map<string, Modifier[]> = new Map();
  /** 便于按 modId 反查 */
  private byId: Map<string, Modifier> = new Map();

  /** 挂载一个 modifier（不 emit，由 caller 通过 engine.emit 披露） */
  attach(mod: Modifier): void {
    if (!this.byUnit.has(mod.targetUnitId)) {
      this.byUnit.set(mod.targetUnitId, []);
    }
    this.byUnit.get(mod.targetUnitId)!.push(mod);
    this.byId.set(mod.id, mod);
  }

  /** 驱散一个 modifier */
  detach(modId: string): Modifier | undefined {
    const mod = this.byId.get(modId);
    if (!mod) return undefined;
    this.byId.delete(modId);
    const list = this.byUnit.get(mod.targetUnitId);
    if (list) {
      const idx = list.findIndex((m) => m.id === modId);
      if (idx >= 0) list.splice(idx, 1);
    }
    return mod;
  }

  /** 查询某单位身上所有指定 kind 的 modifier，按 priority 降序 */
  query(unitId: string, kind: ModifierKind): Modifier[] {
    const list = this.byUnit.get(unitId) ?? [];
    return list
      .filter((m) => m.kind === kind)
      .sort((a, b) => b.priority - a.priority);
  }

  /** 查询某单位身上所有 modifier */
  listFor(unitId: string): Modifier[] {
    return [...(this.byUnit.get(unitId) ?? [])];
  }

  /** 遍历所有 modifier（用于生命周期检查） */
  forEach(cb: (mod: Modifier) => void): void {
    this.byId.forEach((m) => cb(m));
  }

  /** 清空（用于 reset）*/
  clear(): void {
    this.byUnit.clear();
    this.byId.clear();
  }
}

/* ============================================================== */
/*  生命周期处理                                                    */
/* ============================================================== */

/**
 * 在每次攻击结束时调用：清理 duration = this_attack 的 modifier
 */
export function cleanupAfterAttack(store: ModifierStore, engine: IBattleEngine): void {
  const expired: Modifier[] = [];
  store.forEach((m) => {
    if (m.duration.type === 'this_attack') expired.push(m);
  });
  for (const m of expired) {
    store.detach(m.id);
    engine.emit(
      'modifier_expired',
      { modId: m.id, kind: m.kind, targetId: m.targetUnitId, reason: 'this_attack_end' },
      `「${m.sourceSkillId}」挂载的修饰器已失效`,
      { targetIds: [m.targetUnitId], skillId: m.sourceSkillId, severity: 'info' },
    );
  }
}

/**
 * 行动轮开始时调用：消费 next_turn 类 modifier（如蓝银囚笼）为本轮生效
 * 同时清理"本单位的 this_turn"类型
 */
export function cleanupOnTurnStart(
  store: ModifierStore,
  turnOwnerId: string,
  engine: IBattleEngine,
): void {
  // 将 next_turn 转为 this_turn
  store.forEach((m) => {
    if (m.duration.type === 'next_turn' && m.duration.turnOwnerId === turnOwnerId) {
      m.duration = { type: 'this_turn', turnOwnerId };
    }
  });
}

/**
 * 行动轮结束时调用：清理 this_turn（当前单位）类 modifier
 */
export function cleanupOnTurnEnd(
  store: ModifierStore,
  turnOwnerId: string,
  engine: IBattleEngine,
): void {
  const expired: Modifier[] = [];
  store.forEach((m) => {
    if (m.duration.type === 'this_turn' && m.duration.turnOwnerId === turnOwnerId) {
      expired.push(m);
    }
  });
  for (const m of expired) {
    store.detach(m.id);
    engine.emit(
      'modifier_expired',
      { modId: m.id, kind: m.kind, targetId: m.targetUnitId, reason: 'turn_end' },
      `「${m.sourceSkillId}」行动轮结束，修饰器失效`,
      { targetIds: [m.targetUnitId], skillId: m.sourceSkillId, severity: 'info' },
    );
  }
}

/**
 * 大回合结束时调用：清理 round_remain 类 modifier（如金帝天火阵）
 */
export function cleanupOnRoundEnd(store: ModifierStore, engine: IBattleEngine): void {
  const expired: Modifier[] = [];
  store.forEach((m) => {
    if (m.duration.type === 'round_remain') expired.push(m);
  });
  for (const m of expired) {
    store.detach(m.id);
    engine.emit(
      'modifier_expired',
      { modId: m.id, kind: m.kind, targetId: m.targetUnitId, reason: 'round_end' },
      `「${m.sourceSkillId}」大回合结束，修饰器失效`,
      { targetIds: [m.targetUnitId], skillId: m.sourceSkillId, severity: 'info' },
    );
  }
}

/**
 * 消费一次"use_count"类 modifier（如薰儿庇护 2 次）
 * 返回剩余次数；若归零则驱散并 emit
 */
export function consumeUseCount(
  store: ModifierStore,
  modId: string,
  engine: IBattleEngine,
): number {
  const mod = [...(store as unknown as { byId: Map<string, Modifier> }).byId.values()].find(
    (m) => m.id === modId,
  );
  if (!mod || mod.duration.type !== 'use_count') return -1;
  mod.duration.remaining -= 1;
  engine.emit(
    'modifier_consumed',
    { modId: mod.id, remaining: mod.duration.remaining },
    `「${mod.sourceSkillId}」生效 1 次，剩余 ${mod.duration.remaining} 次`,
    { skillId: mod.sourceSkillId, severity: 'info' },
  );
  if (mod.duration.remaining <= 0) {
    store.detach(mod.id);
    engine.emit(
      'modifier_expired',
      { modId: mod.id, reason: 'use_count_exhausted' },
      `「${mod.sourceSkillId}」次数已耗尽`,
      { skillId: mod.sourceSkillId, severity: 'info' },
    );
  }
  return mod.duration.remaining;
}
