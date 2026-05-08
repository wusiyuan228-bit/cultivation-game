/**
 * BattleEngine 主类实现
 *
 * 这是契约 §1 架构的"引擎层"：
 *   - 持有所有 BattleUnit 的权威数据
 *   - 持有 ModifierStore
 *   - 持有 LogEntry[] 输出流（UI 只读）
 *   - 提供 resolveAttack / turnAdvance / checkAwakening 等上层 API
 *
 * 使用方式：
 *   const engine = new BattleEngine();
 *   engine.initBattle(playerUnits, enemyUnits);
 *   engine.resolveAttack(attackerId, defenderId);
 *   const logs = engine.drainLogs();  // 被 UI 层消费后清空
 */

import {
  type BattleUnit,
  type LogEntry,
  type LogEntryKind,
  type LogSeverity,
  type Modifier,
  type ModifierKind,
  type IBattleEngine,
  type HookName,
  type AttackContext,
} from './types';
import {
  ModifierStore,
  cleanupAfterAttack,
  cleanupOnTurnStart,
  cleanupOnTurnEnd,
  cleanupOnRoundEnd,
} from './modifierSystem';
import {
  resolveAttack as _resolveAttack,
  type AttackOptions,
  type AttackResult,
} from './resolveAttack';
import { SkillRegistry } from './skillRegistry';
import { performAwakeningOnEngineUnit } from '@/data/awakeningEngine';

export class BattleEngine implements IBattleEngine {
  private units: Map<string, BattleUnit> = new Map();
  private modStore = new ModifierStore();
  private logs: LogEntry[] = [];
  private seq = 0;
  private round = 1;
  private currentActorId: string | undefined;

  /* ============ 初始化 ============ */

  initBattle(allUnits: BattleUnit[]): void {
    this.units.clear();
    this.modStore.clear();
    this.logs = [];
    this.seq = 0;
    this.round = 1;
    for (const u of allUnits) {
      this.units.set(u.id, u);
      // 觉醒上场时的自动 modifier 暂不挂（仅觉醒切换时才处理，阶段 C）
      // 本体上场时若某技能是"常驻 passive"也不需要 modifier（hook 直接查 skills 列表）
    }
  }

  /* ============ IBattleEngine 接口实现 ============ */

  getUnit(id: string): BattleUnit | undefined {
    return this.units.get(id);
  }

  getAllUnits(): BattleUnit[] {
    return [...this.units.values()];
  }

  getAlliesOf(unit: BattleUnit): BattleUnit[] {
    return this.getAllUnits().filter((u) => u.owner === unit.owner && u.id !== unit.id && u.isAlive);
  }

  getEnemiesOf(unit: BattleUnit): BattleUnit[] {
    return this.getAllUnits().filter((u) => u.owner !== unit.owner && u.isAlive);
  }

  emit(
    kind: LogEntryKind,
    payload: Record<string, unknown>,
    narrative: string,
    opts?: { actorId?: string; targetIds?: string[]; skillId?: string; severity?: LogSeverity },
  ): void {
    const severity: LogSeverity = opts?.severity ?? this.defaultSeverity(kind);
    const entry: LogEntry = {
      seq: this.nextSeq(),
      timestamp: Date.now(),
      round: this.round,
      kind,
      actorId: opts?.actorId,
      targetIds: opts?.targetIds,
      skillId: opts?.skillId,
      severity,
      payload,
      narrative,
    };
    this.logs.push(entry);
  }

  changeStat(
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
  ): number {
    const u = this.units.get(unitId);
    if (!u) return 0;
    const box = u[stat];
    const oldValue = box.current;

    let newValue = oldValue + delta;
    // floor 下限约束
    if (opts.floor !== undefined) newValue = Math.max(opts.floor, newValue);
    // cap 上限约束（仅 hp 默认 hpCap；atk/mnd 理论无 cap 但也不能随意突破）
    if (stat === 'hp' && !opts.breakCap) {
      newValue = Math.min(newValue, u.hpCap);
    }
    // hp 下限自然 0（由 Phase 7 判定死亡）
    if (stat === 'hp') newValue = Math.max(0, newValue);

    // 永久修改 base
    if (opts.permanent) {
      box.base = Math.max(opts.floor ?? 0, box.base + delta);
      if (stat === 'hp' && opts.breakCap) {
        u.hpCap = Math.max(u.hpCap, newValue); // 突破上限类同时拉高 cap
      }
    }
    box.current = newValue;

    const actualDelta = newValue - oldValue;
    if (actualDelta !== 0) {
      this.emit(
        'stat_change',
        {
          targetId: unitId,
          stat,
          delta: actualDelta,
          oldValue,
          newValue,
          permanent: opts.permanent,
          breakCap: !!opts.breakCap,
          reason: opts.reason,
        },
        `${u.name} ${this.statNameZh(stat)} ${actualDelta >= 0 ? '+' : ''}${actualDelta}（${opts.reason}） → ${newValue}`,
        { targetIds: [unitId], skillId: opts.skillId, severity: 'info' },
      );
    }
    return actualDelta;
  }

  attachModifier(mod: Modifier): void {
    this.modStore.attach(mod);
    this.emit(
      'modifier_applied',
      {
        modId: mod.id,
        kind: mod.kind,
        targetId: mod.targetUnitId,
        sourceSkillId: mod.sourceSkillId,
      },
      `「${mod.sourceSkillId}」挂载修饰器到 ${this.units.get(mod.targetUnitId)?.name ?? mod.targetUnitId}`,
      {
        actorId: mod.sourceUnitId,
        targetIds: [mod.targetUnitId],
        skillId: mod.sourceSkillId,
        severity: 'info',
      },
    );
  }

  queryModifiers(unitId: string, kind: ModifierKind): Modifier[] {
    return this.modStore.query(unitId, kind);
  }

  detachModifier(modId: string, reason: string): void {
    const mod = this.modStore.detach(modId);
    if (!mod) return;
    this.emit(
      'modifier_expired',
      { modId, reason },
      `「${mod.sourceSkillId}」修饰器已失效（${reason}）`,
      { skillId: mod.sourceSkillId, severity: 'info' },
    );
  }

  fireHook(unit: BattleUnit, hookName: HookName, _ctx: AttackContext): void {
    // 由 resolveAttack 内部调用 collectHooks，引擎层只暴露占位接口
    // 不应在攻击流程之外被调用
  }

  fireTurnHook(unit: BattleUnit, hookName: 'on_turn_start' | 'on_turn_end'): void {
    // 遍历该单位 skills 中挂 on_turn_* 的 handler
    for (const skillId of unit.skills) {
      const skill = SkillRegistry.get(skillId);
      if (!skill) continue;
      const handler = skill.hooks[hookName];
      if (!handler) continue;
      try {
        (handler as any)(
          {
            unit,
            phase: hookName === 'on_turn_start' ? 'start' : 'end',
            round: this.round,
            hookFiredSet: new Set<string>(),
          },
          this,
        );
      } catch (e) {
        console.error(`[Engine] turn hook ${hookName} on ${unit.name} threw:`, e);
      }
    }
  }

  getRound(): number {
    return this.round;
  }

  nextSeq(): number {
    this.seq += 1;
    return this.seq;
  }

  getCurrentActorId(): string | undefined {
    return this.currentActorId;
  }

  triggerAwakening(unit: BattleUnit, reason: string): void {
    // 阶段 C：委托给 performAwakeningOnEngineUnit
    // 真正做：原子替换数值与技能 + emit form_change + 挂载 autoModifiers
    // 注意：这里仅处理 EngineUnit 侧；store-adapted 的 S7B 需要在 store 层另做同步
    if (unit.awakened) return;
    performAwakeningOnEngineUnit(unit, this);
    void reason;
  }

  /* ============ 流程接口 ============ */

  performAttack(attackerId: string, defenderId: string, opts?: AttackOptions): AttackResult {
    const result = _resolveAttack(attackerId, defenderId, this, opts);
    // 攻击结束清理 this_attack 类 modifier
    cleanupAfterAttack(this.modStore, this);
    return result;
  }

  beginTurn(unitId: string): void {
    this.currentActorId = unitId;
    const u = this.units.get(unitId);
    if (!u) return;
    cleanupOnTurnStart(this.modStore, unitId, this);
    this.emit(
      'turn_start',
      { unitId, round: this.round },
      `—— ${u.name} 的行动轮 ——`,
      { actorId: unitId, severity: 'info' },
    );
    this.fireTurnHook(u, 'on_turn_start');
  }

  endTurn(unitId: string): void {
    const u = this.units.get(unitId);
    if (!u) return;
    this.fireTurnHook(u, 'on_turn_end');
    this.emit(
      'turn_end',
      { unitId, round: this.round },
      `—— ${u.name} 行动结束 ——`,
      { actorId: unitId, severity: 'debug' },
    );
    cleanupOnTurnEnd(this.modStore, unitId, this);
    this.currentActorId = undefined;
  }

  advanceRound(): void {
    cleanupOnRoundEnd(this.modStore, this);
    this.round += 1;
    this.emit(
      'round_start',
      { round: this.round },
      `—— 第 ${this.round} 大回合开始 ——`,
      { severity: 'info' },
    );
  }

  /* ============ 战报输出 ============ */

  drainLogs(): LogEntry[] {
    const out = this.logs;
    this.logs = [];
    return out;
  }

  peekLogs(): LogEntry[] {
    return [...this.logs];
  }

  /* ============ 辅助 ============ */

  private defaultSeverity(kind: LogEntryKind): LogSeverity {
    switch (kind) {
      case 'damage_applied':
      case 'skill_effect_applied':
      case 'skill_effect_blocked':
      case 'stat_change':
        return 'highlight';
      case 'skill_active_cast':
      case 'unit_leave':
      case 'revive':
      case 'battle_victory':
      case 'battle_defeat':
      case 'form_change':
        return 'climax';
      case 'damage_calc':
        return 'debug';
      default:
        return 'info';
    }
  }

  private statNameZh(stat: 'hp' | 'atk' | 'mnd'): string {
    return stat === 'hp' ? '气血' : stat === 'atk' ? '修为' : '心境';
  }
}
