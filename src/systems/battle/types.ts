/**
 * 战斗引擎类型系统（严格对齐《战斗引擎_实装契约》§2）
 *
 * 本文件是引擎重构的地基，所有 Unit/Modifier/LogEntry/SkillContext
 * 的结构均按契约 §2.1 - §2.5 完整枚举定义。
 *
 * 设计铁律：
 *   1. UI 层只读 BoardState + LogEntry 流，不直接读引擎内部状态
 *   2. 每次 BoardState 改写必须 emit 至少一条 LogEntry
 *   3. LogEntryKind 枚举只增不减，老版本废弃而不删除
 */

import type { CultivationType } from '@/types/game';

/* ============================================================== */
/*  §2.1 BattleUnit                                                 */
/* ============================================================== */

export type UnitForm = 'base' | 'awakened';

/** 每个属性同时保留 base / current / initial 三份，供 modifier 计算 */
export interface StatBox {
  base: number;      // 卡面原值
  current: number;   // 当前实际值（受 modifier 影响）
  initial: number;   // 战斗开场时的初始值（玄骨·stat_reset 用）
}

/** 回合统计（§3.9 严谨定义） */
export interface TurnStats {
  didBasicAttack: boolean;
  didUltimateAttack: boolean;
  damageDealtToOthers: number;
  /** 本轮是否造成过任何伤害（含反伤/溅射/自伤，对齐 Q36 & Q58 · 2026-05-01 统一定义） */
  didCauseAnyDamage: boolean;
  /**
   * 本轮是否移动过（Q52 裁决 · 含主动移动 + 被动位移，如柔骨·缠魂/风闲拉拽/藤化原等）
   * 拓森"未移动"类判定、紫妍"移动后+1"类判定均读此字段
   */
  hasMoved: boolean;
  extraActionsGranted: number;
  extraActionsConsumed: number;
}

export interface BattleUnit {
  /** 战场唯一 id（觉醒后不变） */
  id: string;
  /** 卡面名称（觉醒会变，如"塘散"→"冥煞·塘散"） */
  name: string;
  /** 修仙类型（剑/妖/体/灵/法/丹） */
  type: CultivationType;
  /** 阵营 owner（"P1" = 玩家方，"P2" = AI 方，兼容 PvP 时更多阵营） */
  owner: string;

  /** 属性三件套 */
  hp: StatBox;
  atk: StatBox;
  mnd: StatBox;
  hpCap: number;     // 气血上限（可被 stat_set_cap 修改）

  /** 战场位置 */
  row: number;
  col: number;

  /** 存活状态（Phase 6 期间 hp 可为 0 但 isAlive 仍 true，见契约 §3 时序） */
  isAlive: boolean;

  /** 形态（base = 本体，awakened = 觉醒）*/
  form: UnitForm;
  /** 本体数据（用于觉醒切换） */
  baseData?: UnitBlueprint;
  /** 觉醒数据 */
  awakenData?: UnitBlueprint;
  /** 是否已觉醒过（one-shot，避免反复切换） */
  awakened: boolean;

  /** 挂载的技能（id 列表，供 SkillRegistry 查询） */
  skills: string[];

  /** 本轮回合统计 */
  perTurn: TurnStats;

  /** 图像路径（仅 UI 使用） */
  portrait: string;

  /** 绝技是否已使用（主动技 active_once 每场 1 次） */
  ultimateUsed: boolean;

  /** 累计击杀敌人数（寒立觉醒触发用） */
  killCount: number;
}

/** UnitBlueprint：觉醒切换时用于整体替换数值与技能 */
export interface UnitBlueprint {
  name: string;
  type: CultivationType;
  hp: number;
  atk: number;
  mnd: number;
  hpCap: number;
  skills: string[];
  portrait?: string;
}

/* ============================================================== */
/*  §2.2 Modifier                                                  */
/* ============================================================== */

export type ModifierCategory = 'aura' | 'temporal' | 'permanent' | 'reactive';

export type ModifierDuration =
  | { type: 'permanent' }
  | { type: 'this_attack' }
  | { type: 'this_turn'; turnOwnerId: string }
  | { type: 'next_turn'; turnOwnerId: string }
  | { type: 'round_remain' }
  | { type: 'permanent_in_battle' }
  | { type: 'while_in_range'; rangeFn: string }
  | { type: 'use_count'; remaining: number };

/** §2.3 ModifierKind 完整枚举（25 种） */
export type ModifierKind =
  // 数值加成 / 减益
  | 'stat_delta'
  | 'stat_set'
  | 'stat_set_cap'
  | 'stat_copy'
  | 'stat_reset_to_initial'
  // 伤害计算修饰
  | 'damage_bonus'
  | 'damage_multiplier'
  | 'damage_reduce'
  | 'damage_cap'
  | 'damage_immune'
  | 'damage_halve'
  | 'damage_redirect'
  | 'damage_reflect'
  // 状态控制
  | 'disable_move'
  | 'disable_attack'
  | 'force_attack'
  | 'hp_floor'
  | 'no_kill'
  // 行动/绝技修饰
  | 'extra_action'
  | 'grant_reroll'
  | 'ultimate_refreshed'
  | 'ultimate_invalidated'
  | 'prevent_death_counter'
  | 'revive_counter'
  // 光环修饰
  | 'aura_stat_bonus'
  | 'aura_range_extend';

export interface Modifier {
  id: string;
  sourceSkillId: string;
  sourceUnitId: string;
  category: ModifierCategory;
  targetUnitId: string;
  kind: ModifierKind;
  payload: Record<string, unknown>;
  duration: ModifierDuration;
  priority: number;
}

/* ============================================================== */
/*  §2.4 / §2.5 LogEntry                                           */
/* ============================================================== */

export type LogSeverity = 'debug' | 'info' | 'highlight' | 'climax';

export type LogEntryKind =
  // 流程类
  | 'round_start'
  | 'round_end'
  | 'turn_start'
  | 'turn_end'
  | 'move'
  | 'extra_action_granted'
  | 'extra_action_consumed'
  // 攻击链
  | 'attack_declared'
  | 'dice_roll_attack'
  | 'dice_roll_defend'
  | 'damage_calc'
  | 'damage_applied'
  // 技能类
  | 'skill_active_cast'
  | 'skill_passive_trigger'
  | 'skill_effect_applied'
  | 'skill_effect_blocked'
  // 修饰器生命周期
  | 'modifier_applied'
  | 'modifier_expired'
  | 'modifier_consumed'
  // 数值与位置变化
  | 'stat_change'
  | 'position_change'
  // 特殊事件
  | 'unit_leave'
  | 'revive'
  | 'ownership_change'
  | 'form_change'
  | 'obstacle_placed'
  // 结算
  | 'battle_victory'
  | 'battle_defeat'
  | 'battle_timeout'
  // 兼容旧战报（过渡期保留）
  | 'legacy_text';

export interface LogEntry {
  seq: number;
  timestamp: number;
  round: number;
  kind: LogEntryKind;
  actorId?: string;
  targetIds?: string[];
  skillId?: string;
  severity: LogSeverity;
  payload: Record<string, unknown>;
  narrative: string;
}

/* ============================================================== */
/*  技能钩子 & 注册表（§3 Three-Phase Hook 规范）                   */
/* ============================================================== */

export type HookName =
  | 'on_before_roll'            // Phase 1 进攻方改骰数
  | 'on_before_defend_roll'     // Phase 2 防守方改骰数
  | 'on_after_attack_roll'      // Phase 3 进攻方滚完骰后（重投等）
  | 'on_before_being_attacked'  // Phase 4 防守方减骰/免疫
  | 'on_damage_calc'            // Phase 5 伤害计算修饰（双向）
  | 'on_after_being_hit'        // Phase 6 防守方反伤
  | 'on_after_hit'              // Phase 6 进攻方吞噬/吸血/debuff
  | 'on_kill'                   // Phase 7 击杀回调
  | 'on_any_death'              // Phase 7 场上任意死亡
  | 'on_any_ally_death'         // Phase 7 友军任意死亡
  | 'on_self_death'             // Phase 7 自身被动战死
  | 'on_self_sacrifice'         // 主动退场（八段摔等）
  | 'on_self_leave'             // 超集：所有退场
  | 'on_turn_start'             // 行动轮开始
  | 'on_turn_end';              // 行动轮结束

/** 攻击上下文（传递给 hook 的运行时信息） */
export interface AttackContext {
  /** 攻击类型：基础攻击 or 技能直接伤害 or 反伤 */
  attackKind: 'basic' | 'skill_damage' | 'reflect' | 'self_damage' | 'env';
  /** 是否为绝技触发 */
  viaUltimate: boolean;
  /** 多段攻击中的段号（从 0 开始） */
  segmentIndex: number;
  /** 触发者 */
  attacker: BattleUnit;
  /** 目标（可能被 redirect 改写） */
  defender: BattleUnit;
  /** 骰数 */
  diceAttack: number;
  diceDefend: number;
  /** 骰结果 */
  aSum: number;
  dSum: number;
  /** 此次攻击所带的技能 id（如"青竹蜂云剑·七十二路"）*/
  skillId?: string;
  /** 触发记录集合（防钩子递归，Q47）*/
  hookFiredSet: Set<string>;
  /** 本次攻击期间累积的 damage_calc 细项（用于战报展开） */
  calcLog: Array<{ source: string; delta: number; note: string }>;
}

/** 钩子处理器：返回值不用（所有状态变更由 engine API 完成） */
export type HookHandler = (ctx: AttackContext, engine: IBattleEngine) => void;

/** Turn 钩子的上下文 */
export interface TurnContext {
  unit: BattleUnit;
  phase: 'start' | 'end';
  round: number;
  hookFiredSet: Set<string>;
}
export type TurnHookHandler = (ctx: TurnContext, engine: IBattleEngine) => void;

/** 目标选择器的类型（供 UI 渲染目标高亮）*/
export type TargetSelector =
  | { kind: 'none' }                         // 无需选目标（如金帝天火阵）
  | { kind: 'single_any_enemy' }             // 任选1敌（如修罗弑神击，无视距离）
  | { kind: 'single_adjacent_enemy' }        // 任选1相邻敌
  | { kind: 'single_line_enemy' }            // 同行/列任1敌（万剑归宗）
  | { kind: 'single_any_character' }         // 任选1角色（柔骨·缠魂，含己方）
  | { kind: 'all_adjacent_enemies' }         // 相邻所有敌（佛怒火莲）
  | { kind: 'cross_adjacent_enemies' }       // 十字四向敌（万毒淬体）
  | { kind: 'all_enemies' }                  // 全场敌（逆·天地崩）
  | { kind: 'all_allies_incl_self' }         // 全场己方（薰儿天火阵 等真 AOE）
  | { kind: 'single_any_ally' }              // 任选1名友军（含自身/含已退场，由 precheck.candidateIds 过滤）
  | { kind: 'position_pick' };               // 选棋盘空格子（如小战祖树盾放障碍）

/** 主动技预检返回 */
export interface PrecheckResult {
  ok: boolean;
  /** 为 false 时给 UI 的按钮置灰提示 */
  reason?: string;
  /** UI 可高亮的候选目标 id 列表（可选，用于渲染）*/
  candidateIds?: string[];
}

/** 技能注册条目 */
export interface SkillRegistration {
  id: string;
  name: string;
  /**
   * 技能所属阶段（默认 'battle'）
   *   - 'battle' : 战斗阶段技能（挂 hook / activeCast）
   *   - 'recruit': 招募阶段技能（如塘散·清心悟道，仅运营期生效）
   *   - 'secret' : 密谈阶段技能（S4 剧情期生效）
   *   - 'city'   : 城内/跑图阶段技能
   * 仅 phase === 'battle' 或 undefined 的技能才会出现在战斗 UI 上。
   */
  phase?: 'battle' | 'recruit' | 'secret' | 'city';
  /**
   * 技能种类（对应策划卡面标签）
   *   - 'battle_skill' : 战斗被动技（cards_all.json 的 battle_skill，多为 hook 被动触发）
   *   - 'ultimate'     : 战斗绝技（cards_all.json 的 ultimate，active_once 主动技）
   *   - 'awaken_skill' : 觉醒被动技
   *   - 'awaken_ult'   : 觉醒绝技
   * 未声明时，按 isActive 推断：isActive=true → 'ultimate'，否则 'battle_skill'
   * 仅在"技能压制/关闭"类效果（如厉飞雨·疾风无影）需要精确区分时使用。
   */
  kind?: 'battle_skill' | 'ultimate' | 'awaken_skill' | 'awaken_ult';
  /** 哪些 hook 上挂哪些 handler */
  hooks: Partial<Record<HookName, HookHandler | TurnHookHandler>>;
  /** 觉醒上场时自动挂载的常驻 modifier（如修罗瞳+2） */
  autoModifiers?: (self: BattleUnit) => Modifier[];
  /** 主动技发动前置检查（active_once 类） */
  precheck?: (self: BattleUnit, engine: IBattleEngine) => PrecheckResult;
  /** 主动技执行体（返回是否应消耗"绝技次数"）*/
  activeCast?: (
    self: BattleUnit,
    targetIds: string[],
    engine: IBattleEngine,
  ) => { consumed: boolean };
  /** 是否为主动技 */
  isActive?: boolean;
  /** 主动技目标选择器（UI 用） */
  targetSelector?: TargetSelector;
  /** 主动技次数上限（默认 1）*/
  maxCasts?: number;
  /**
   * 位置变化钩子（P5 · Q77）
   *   - 任一单位发生位置变化时，对所有存活单位携带此技能者回调
   *   - 典型用途：aura 型光环（古元天火阵）在 anyone 移动后重算覆盖范围
   *   - movedUnitId: 触发位置变化的那个单位（可能是 self、友军、敌军或自身）
   */
  onPositionChange?: (
    self: BattleUnit,
    movedUnitId: string,
    engine: IBattleEngine,
  ) => void;
  /**
   * 主动技绝技释放后的"后置攻击"声明（2026-05-11 架构升级 · 跨 store 通用）
   *
   * 设计动机：很多绝技的语义是"挂临时 buff（如 atk+4） + 立刻发起 1 次攻击"。
   *   activeCast 内部因为没有 store API（无法真正调用 attack→resolveAttack→走全部 hook），
   *   只能 attach buff + emit 意图。真正的攻击必须由 store 层在 activeCast 返回后接续。
   *
   *   旧实现：在 battleStore / s7bBattleStore 的 performUltimate 中维护一份"白名单 + 路由表"，
   *           每加一张瞄准型攻击绝技就要改 3 个 store。
   *   新实现：技能文件自己声明 followUpAttack，store 层用统一 helper（runFollowUpAttack）展开。
   *
   * 仅"瞄准型攻击绝技"才需要声明（即攻击由真实 attack() 走 resolveAttack 完成的）；
   * 已自己 engine.changeStat 完成固伤的（如韩立·觉醒大衍、王林·一念逆天）不需要。
   */
  followUpAttack?: {
    /**
     * 攻击目标解析方式：
     *   - 'targetIds'   : 使用 effectiveTargetIds（含 AOE 时由 precheck.candidateIds 自动填充）
     *   - 'first_only'  : 只攻击 effectiveTargetIds[0]（瞄准单体）
     */
    target?: 'targetIds' | 'first_only';
    /** 是否对每个 target 都展开（多段攻击）；默认 false（仅打第一个） */
    perTarget?: boolean;
    /**
     * 攻击前临时改写 attacker.atk（等价于"额外投X骰"语义）
     * 注意：传入的 self 是 store 侧的简化对象，atk 字段为 { current: number }（兼容引擎 StatBox 形态）
     * 返回新的 atk 值（store 层会在 attack 后还原）
     */
    diceOverride?: (self: { atk: { current: number } }) => number;
    /**
     * 命中后回调（每段攻击命中后调用一次，可对 target 做永久 atk-1 等额外效果）
     * 注意：传入的 target 是 store 侧的 mutable copy，atk/name 都是基础类型；
     *       store 层会写回 units[]
     */
    postHit?: (
      target: { atk: number; name: string; [key: string]: any },
      addLog: (text: string) => void,
    ) => void;
  };
  /**
   * 玩家可控的 on_turn_start hook 元数据（2026-05-11 玩家选择弹窗）
   *
   * 当声明此字段时，turn_start dispatcher 在玩家方控制下会跳过原 hook，
   * 转而暂存为 store.pendingTurnStartChoice，由 UI 层弹窗。AI 控制下保持
   * 原 on_turn_start hook 自动逻辑不变（用户偏好 a · 保留当前自动逻辑）。
   *
   * 已声明此元数据的技能：云鹊子·癫狂窃元、凝荣荣·七宝琉璃加持、顾河·炼药聚元炉、
   * 天云子·命格逆转、雅妃·迦南商会补给。
   */
  interactiveOnTurnStart?: {
    /** 弹窗标题（显示在「是否发动」对话框上方） */
    promptTitle: string;
    /** 弹窗主文案 */
    promptBody: string;
    /**
     * 收集可选 (target, stats?) 候选。返回空数组 → hook 视为不可触发，跳过弹窗。
     * 同一 target 可多次出现以表示不同属性可选，但更建议用 stats 字段表达。
     */
    collectChoices: (
      self: BattleUnit,
      engine: IBattleEngine,
    ) => Array<{
      targetId: string;
      /** 该目标可选的属性（如 ['atk','mnd','hp']）；无此字段则只选目标 */
      stats?: Array<'atk' | 'mnd' | 'hp'>;
    }>;
    /** 选择完成后的执行体（由 store 在玩家点击确认后调用） */
    apply: (
      self: BattleUnit,
      target: BattleUnit,
      stat: 'atk' | 'mnd' | 'hp' | undefined,
      engine: IBattleEngine,
    ) => void;
  };
  /**
   * 玩家可控的 on_turn_end hook 元数据（2026-05-13 · 大香肠等"回合结束选人"型技能）
   *
   * 对称于 interactiveOnTurnStart，但触发时机是 actor 行动轮结束。
   * 典型技能：傲思卡·大香肠（行动轮结束时，可指定 1 名友军气血+2）
   */
  interactiveOnTurnEnd?: {
    /** 弹窗标题 */
    promptTitle: string;
    /** 弹窗主文案 */
    promptBody: string;
    /** 收集可选项（空数组 → 跳过弹窗，AI 走 hook 自动逻辑） */
    collectChoices: (
      self: BattleUnit,
      engine: IBattleEngine,
    ) => Array<{
      targetId: string;
      stats?: Array<'atk' | 'mnd' | 'hp'>;
    }>;
    /** 玩家确认后的执行体 */
    apply: (
      self: BattleUnit,
      target: BattleUnit,
      stat: 'atk' | 'mnd' | 'hp' | undefined,
      engine: IBattleEngine,
    ) => void;
  };
  /**
   * 玩家可控的"棋盘选位"型技能元数据（2026-05-11 方案A · 流程钩子层）
   *
   * 用途：风属斗技、灵犀诀传送、断魂位移… 这类需要让玩家在棋盘上点选一个目标格的技能。
   * 与 interactiveOnTurnStart 的差异：
   *   - turnStart 是行动开始时的「选目标 + 选属性」型弹窗
   *   - positionPick 是攻击/技能命中后的「在棋盘上点选格子」型交互
   *
   * 当前已声明此元数据的技能：纳兰嫣然·风属斗技（迁移规划中 · Commit 3）
   *
   * 设计契约：
   *   - 仅当玩家方控制施法者且 trigger.when() 返回 true 时才触发
   *   - 由 store 在攻击流水线相应位置调用 store.submitPendingChoice({kind:'fengshu_pick',...})
   *     UI 层渲染棋盘高亮；玩家点格子后 store.confirmPositionPick(row,col) 完成 apply
   */
  interactivePositionPick?: {
    /** 弹窗标题 */
    promptTitle: string;
    /** 弹窗主文案 */
    promptBody: string;
    /** 时机：'after_hit' 命中后；'on_cast' 释放绝技时 */
    trigger: 'after_hit' | 'on_cast';
    /**
     * 计算可落点列表
     *   - 返回空 → 视为不可发动，跳过弹窗（与 turnStart 一致）
     */
    collectCandidates: (
      self: BattleUnit,
      target: BattleUnit | undefined,
      engine: IBattleEngine,
    ) => Array<{ row: number; col: number }>;
    /** 玩家选定后执行体（store 调用） */
    apply: (
      self: BattleUnit,
      target: BattleUnit | undefined,
      pos: { row: number; col: number },
      engine: IBattleEngine,
    ) => void;
  };
  /** 描述（未揭示时显示"效果未知"）*/
  description: string;
}

/* ============================================================== */
/*  引擎对外接口（skill handler 只能通过 engine 改状态）           */
/* ============================================================== */

export interface IBattleEngine {
  getUnit(id: string): BattleUnit | undefined;
  getAllUnits(): BattleUnit[];
  getAlliesOf(unit: BattleUnit): BattleUnit[];
  getEnemiesOf(unit: BattleUnit): BattleUnit[];

  /** emit 一条战报 */
  emit(
    kind: LogEntryKind,
    payload: Record<string, unknown>,
    narrative: string,
    opts?: { actorId?: string; targetIds?: string[]; skillId?: string; severity?: LogSeverity },
  ): void;

  /** 修改单位属性（会自动 emit stat_change） */
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
  ): number; // 返回实际变化量

  /** 挂载 modifier */
  attachModifier(mod: Modifier): void;
  /** 查询 modifier */
  queryModifiers(unitId: string, kind: ModifierKind): Modifier[];
  /** 驱散 modifier */
  detachModifier(modId: string, reason: string): void;

  /** 注册一个攻击钩子（由技能 handler 内部调用很少，通常通过 SkillRegistry 自动挂载）*/
  fireHook(unit: BattleUnit, hookName: HookName, ctx: AttackContext): void;
  fireTurnHook(unit: BattleUnit, hookName: 'on_turn_start' | 'on_turn_end'): void;

  /** 获取当前回合数 */
  getRound(): number;
  /** 获取全局 seq */
  nextSeq(): number;
  /** 获取当前行动单位 id */
  getCurrentActorId(): string | undefined;
  /** 标记单位觉醒（仅由触发器调用） */
  triggerAwakening(unit: BattleUnit, reason: string): void;
}

/* ============================================================== */
/*  常量                                                            */
/* ============================================================== */

/** 契约 §3.2 最低伤害规则 */
export const MIN_ATTACK_DAMAGE = 1;
export const MIN_SKILL_DAMAGE = 1;

/** priority 默认梯度 */
export const PRIORITY = {
  CONSTANT: 0,
  AURA: 10,
  TEMPORAL: 20,
  HP_FLOOR: 100,
  PREVENT_DEATH: 200,
  REVIVE: 300,
} as const;
