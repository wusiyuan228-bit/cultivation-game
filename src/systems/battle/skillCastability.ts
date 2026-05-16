/**
 * 技能"使用次数 + 可交互性"判定工具（S5a / S7 / S7B 统一）
 *
 * 语义（用户裁决）：
 *   - 绿灯 = 是否仍有剩余使用次数 / 被动技仍在生效
 *   - 可交互 = 本回合/战场条件是否允许玩家立刻发动
 *
 * 交互规则：
 *   状态                           | 灯    | 按钮 disabled | hover tip
 *   -----------------------------|-------|--------------|---------------------
 *   被动技（无 activeCast）          | 🟢亮 | ❌永远 disabled | "被动技能，战斗中持续生效"
 *   主动技 · 有次数 · 条件满足        | 🟢亮 | ✅可点击        | 技能描述
 *   主动技 · 有次数 · 条件不满足      | 🟢亮 | ❌disabled      | ❌ 当前不满足：距离/目标等
 *   主动技 · 次数已耗尽               | ⚫灭 | ❌disabled      | "已使用"
 *
 * 目标扫描精准化（2026-05 裁决）：
 *   按 targetSelector.kind 真实作用范围扫描"是否存在合法目标"：
 *   - cross_adjacent_enemies / all_adjacent_enemies / single_adjacent_enemy
 *        → 相邻 4 格（上下左右，曼哈顿=1）需至少 1 敌
 *   - single_line_enemy  → 同行或同列需至少 1 敌
 *   - single_any_enemy / all_enemies → 场上需至少 1 敌存活
 *   - auto_self / all_allies_incl_self / none → 无条件可放
 *   - 未登记技能（兜底）→ 按攻击附带型处理（相邻 4 格需至少 1 敌）
 */

import { SkillRegistry } from './skillRegistry';

/** 结构型 BattleUnit 接口（同时兼容 S7 老 store / S7B 新 store 两种 BattleUnit） */
export interface SkillCheckUnit {
  dead: boolean;
  row: number;
  col: number;
  isEnemy?: boolean;
  id: string;
  attackedThisTurn?: boolean;
  ultimateUsed: boolean;
  /** 主动战斗技能是否已使用（每场1次，2026-05-10 新增） */
  battleSkillUsed?: boolean;
  ultimate: { name: string; desc: string } | null;
  battleSkill: { name: string; desc: string } | null;
}

export interface SkillCastabilityCtx {
  /** 本回合是否已用过任意技能 */
  skillUsedThisTurn: boolean;
  /** 全场存活/退场单位列表（由调用方传入，内部按 selector 精准扫描） */
  allUnits?: SkillCheckUnit[];
  /** ====== 以下为兼容字段，若未提供 allUnits 则使用这些粗略信号 ====== */
  /** 相邻 4 格是否有存活敌人（攻击附带/十字/AOE 相邻型必备） */
  hasAdjacentEnemy?: boolean;
  /** 场上是否有任一存活敌人（远程/AOE 型绝技的弱条件） */
  hasAnyEnemy?: boolean;
}

export interface SkillCastability {
  /** 是否仍有剩余使用次数（决定绿灯是否亮） */
  hasCharges: boolean;
  /** 本次是否可交互（决定按钮是否 disabled） */
  interactable: boolean;
  /** 是否为被动技（UI 渲染为"常驻提示"，无按钮） */
  isPassive: boolean;
  /** 不可交互原因（hover tip 文案） */
  reason?: string;
}

export function checkSkillCastability(
  unit: SkillCheckUnit,
  skillType: 'battle' | 'ultimate',
  ctx: SkillCastabilityCtx,
): SkillCastability {
  // ============ 零：空保护 ============
  if (!unit || unit.dead) {
    return { hasCharges: false, interactable: false, isPassive: false, reason: '单位已退场' };
  }
  const skillMeta = skillType === 'ultimate' ? unit.ultimate : unit.battleSkill;
  if (!skillMeta) {
    return { hasCharges: false, interactable: false, isPassive: false, reason: '无此技能' };
  }

  // ============ 一：从 SkillRegistry 反查技能类型 ============
  const regId = SkillRegistry.findIdByName(skillMeta.name);
  const registration = regId ? SkillRegistry.get(regId) : undefined;
  const isActive = registration?.isActive === true;
  const selectorKind = registration?.targetSelector?.kind;

  // ============ 二：被动技 ============
  if (registration && !isActive) {
    return {
      hasCharges: true,
      interactable: false,
      isPassive: true,
      reason: '被动技能 · 战斗中持续生效',
    };
  }

  // ============ 三：次数判定 ============
  if (skillType === 'ultimate') {
    if (unit.ultimateUsed) {
      return {
        hasCharges: false,
        interactable: false,
        isPassive: false,
        reason: '绝技已在本场战斗使用过',
      };
    }
  }
  // 主动战斗技（如藤化原·天鬼搜身）：每场1次（2026-05-10）
  if (skillType === 'battle' && isActive && unit.battleSkillUsed) {
    return {
      hasCharges: false,
      interactable: false,
      isPassive: false,
      reason: '战斗技能已在本场战斗使用过',
    };
  }
  if (ctx.skillUsedThisTurn) {
    return {
      hasCharges: skillType === 'ultimate' ? !unit.ultimateUsed : false,
      interactable: false,
      isPassive: false,
      reason: '本回合已用过技能',
    };
  }

  // ============ 四：交互条件 ============
  if (unit.attackedThisTurn) {
    return {
      hasCharges: true,
      interactable: false,
      isPassive: false,
      reason: '本回合已普攻，技能不可再挂载',
    };
  }

  // ---- 距离/目标条件：按 selector 精准扫描 ----
  // 4.1 未登记：
  //   · 绝技（ultimate）：尚未实装 → 直接置灰，hover 提示"暂未实装"
  //     （UR 玄寂长老·轮回珠·噬魂 / UR 风无痕·轮回珠·裂天 等）
  //   · 战技（battle）：兜底为"攻击附带型"，需相邻敌人（保留原逻辑兼容旧用法）
  if (!registration) {
    if (skillType === 'ultimate') {
      return {
        hasCharges: false,
        interactable: false,
        isPassive: false,
        reason: '该绝技效果暂未实装，敬请期待',
      };
    }
    const ok = ctx.allUnits ? hasAdjacentEnemyOf(unit, ctx.allUnits) : !!ctx.hasAdjacentEnemy;
    if (!ok) {
      return {
        hasCharges: true,
        interactable: false,
        isPassive: false,
        reason: '无可释放目标（相邻4格无敌方单位）',
      };
    }
    return { hasCharges: true, interactable: true, isPassive: false };
  }

  // 4.2 已登记：按 targetSelector 真实作用范围扫描
  switch (selectorKind) {
    case 'single_adjacent_enemy':
    case 'all_adjacent_enemies':
    case 'cross_adjacent_enemies': {
      // 相邻 4 格（上下左右）需至少 1 敌
      const ok = ctx.allUnits ? hasAdjacentEnemyOf(unit, ctx.allUnits) : !!ctx.hasAdjacentEnemy;
      if (!ok) {
        return {
          hasCharges: true,
          interactable: false,
          isPassive: false,
          reason: '无可释放目标（相邻4格无敌方单位）',
        };
      }
      return { hasCharges: true, interactable: true, isPassive: false };
    }
    case 'single_line_enemy': {
      // 同行或同列需至少 1 敌
      const ok = ctx.allUnits
        ? hasSameLineEnemyOf(unit, ctx.allUnits)
        : (ctx.hasAnyEnemy ?? !!ctx.hasAdjacentEnemy);
      if (!ok) {
        return {
          hasCharges: true,
          interactable: false,
          isPassive: false,
          reason: '无可释放目标（所在行列无敌方单位）',
        };
      }
      return { hasCharges: true, interactable: true, isPassive: false };
    }
    case 'single_any_enemy':
    case 'all_enemies': {
      // 全场至少 1 敌存活
      const ok = ctx.allUnits
        ? hasAnyLivingEnemyOf(unit, ctx.allUnits)
        : (ctx.hasAnyEnemy ?? !!ctx.hasAdjacentEnemy);
      if (!ok) {
        return {
          hasCharges: true,
          interactable: false,
          isPassive: false,
          reason: '无可释放目标（敌方已全灭）',
        };
      }
      return { hasCharges: true, interactable: true, isPassive: false };
    }
    case 'single_any_character':
    case 'all_allies_incl_self':
    case 'single_any_ally':
    case 'none':
    case 'position_pick':
    default: {
      // auto_self / 全场 allies AOE / 任选友军 / 无目标型 / 位置选 → 无条件可放（施法者存活即可）
      // position_pick 的合法空格校验由 UI 层瞄准态实时判定，这里只确认施法者存活
      return { hasCharges: true, interactable: true, isPassive: false };
    }
  }
}

/** 判定某单位四周（曼哈顿=1 = 上下左右）是否存在存活的敌对单位 */
export function hasAdjacentEnemyOf(unit: SkillCheckUnit, allUnits: SkillCheckUnit[]): boolean {
  for (const other of allUnits) {
    if (other.dead || other.id === unit.id) continue;
    if (other.isEnemy === unit.isEnemy) continue;
    if (Math.abs(other.row - unit.row) + Math.abs(other.col - unit.col) === 1) return true;
  }
  return false;
}

/** 判定某单位所在行或列（不含斜线）是否存在存活敌人（用于 single_line_enemy） */
export function hasSameLineEnemyOf(unit: SkillCheckUnit, allUnits: SkillCheckUnit[]): boolean {
  for (const other of allUnits) {
    if (other.dead || other.id === unit.id) continue;
    if (other.isEnemy === unit.isEnemy) continue;
    if (other.row === unit.row || other.col === unit.col) return true;
  }
  return false;
}

/** 判定场上是否存在存活敌人（用于 AOE/远程型绝技） */
export function hasAnyLivingEnemyOf(unit: SkillCheckUnit, allUnits: SkillCheckUnit[]): boolean {
  for (const other of allUnits) {
    if (other.dead || other.id === unit.id) continue;
    if (other.isEnemy !== unit.isEnemy) return true;
  }
  return false;
}
