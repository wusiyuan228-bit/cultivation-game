/**
 * 战斗流程"待玩家选择"统一类型（2026-05-11 方案A · 流程钩子层）
 *
 * 背景：
 *   现状有 3 套战斗 store（battleStore / s7bBattleStore / s7dBattleStore），
 *   它们各自维护多种"中断流程→等玩家选择→恢复"的 pending 状态：
 *     · pendingTurnStartChoice    （行动轮开始可选发动技能）
 *     · fengshuPick (UI侧)        （风属斗技选位）
 *     · ultimateTargeting (UI侧)  （绝技瞄准）
 *     · pendingSkillMod           （技能加成应用）
 *
 *   每加一个新弹窗式技能，都要在 3 个 store + 3 个 UI 文件里重复实现 6 处。
 *
 * 本模块的抽象：
 *   把所有"中断 → 等玩家 → 恢复"的需求，统一为单一的 PendingChoice 联合类型。
 *   store 只持有一个 pendingChoice 字段，UI 只挂一个 <BattleChoiceHost/>。
 *
 * 后续每加一种新弹窗交互技能，仅需：
 *   1. 在技能注册元数据中声明对应的 interactive 字段（已有的 interactiveOnTurnStart
 *      / followUpAttack 都是这种形态）
 *   2. 在 PendingChoice 联合中加一个 kind 分支
 *   3. 在 BattleChoiceHost 渲染对应组件（或复用现有组件）
 *   ——— 不再需要改 store 流程编排代码 ———
 */

/* ─────────────────────────────────────────────────────────────
 * Kind = 'turn_start_skill'
 * 行动轮开始时，玩家可主动发动的技能（云鹊子/凝荣荣/谷鹤/天云子/雅妃 等）
 * 由 turnStartDispatcher 发现 interactiveOnTurnStart 元数据时构造
 * ───────────────────────────────────────────────────────────── */
export interface PendingTurnStartChoice {
  kind: 'turn_start_skill';
  /** 行动者 id */
  actorId: string;
  /** 触发的技能 id */
  skillId: string;
  /** 弹窗标题 */
  promptTitle: string;
  /** 弹窗主文案 */
  promptBody: string;
  /** 候选目标 + 可选属性 */
  choices: Array<{
    targetId: string;
    stats?: Array<'atk' | 'mnd' | 'hp'>;
  }>;
}

/* ─────────────────────────────────────────────────────────────
 * Kind = 'fengshu_pick'
 * 纳兰嫣然·风属斗技：进攻命中后选位传送目标
 * 当前由 UI 层 useState 管理，未来统一迁移到 store.pendingChoice
 * ───────────────────────────────────────────────────────────── */
export interface PendingFengShuChoice {
  kind: 'fengshu_pick';
  /** 攻击者 id（必为纳兰嫣然） */
  attackerId: string;
  /** 受击目标 id */
  defenderId: string;
  /** 玩家点了发动后才会切换到 picking 阶段 */
  phase: 'ask' | 'picking';
  /** 合法落点（2 格内空格） */
  candidates: Array<{ row: number; col: number }>;
  /** 进攻所带的技能加成（store 在玩家确认落点后回放 attack 时复用） */
  skillMod?: number;
}

/* ─────────────────────────────────────────────────────────────
 * 联合类型：未来扩展只需加 Kind 分支
 * ───────────────────────────────────────────────────────────── */
export type PendingChoice = PendingTurnStartChoice | PendingFengShuChoice;

/** 类型守卫 */
export function isTurnStartChoice(p: PendingChoice | null | undefined): p is PendingTurnStartChoice {
  return !!p && p.kind === 'turn_start_skill';
}
export function isFengShuChoice(p: PendingChoice | null | undefined): p is PendingFengShuChoice {
  return !!p && p.kind === 'fengshu_pick';
}
