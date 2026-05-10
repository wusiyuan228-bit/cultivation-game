/**
 * 伤害减免 / 重定向 / 触底 管线
 *
 * 背景（2026-05-10）：
 *   薰儿绝技【金帝天火阵】、觉醒绝技【古族祖灵结界】等技能挂载了
 *   damage_reduce / damage_redirect / hp_floor 三种 modifier，
 *   但战斗 store 的 changeStat 实现里完全没有读取这些 modifier，
 *   导致这些绝技"挂着却不生效"。
 *
 *   本模块提供集中的伤害管线工具，所有 store 的 changeStat 在
 *   "stat==='hp' 且 delta<0"（即受伤）时调用 applyDamagePipeline，
 *   返回处理后的最终扣血对象 { unitId, delta, redirectedFrom?, reduced? }。
 *
 * 处理顺序（契约 §5.1 ⑥⑧）：
 *   1) damage_redirect：将伤害转嫁到指定单位（薰儿觉醒绝技：所有友军伤害转嫁给薰儿）
 *      - 自损（reason 含"自损"或 attackerId === unitId）不重定向
 *   2) damage_reduce：减少伤害值（薰儿本体绝技：友军伤害-3，最低=floor）
 *   3) hp_floor：被减少血量后，hp 不能低于该 floor（薰儿觉醒绝技：薰儿 hp 最低=1）
 *
 * 注：本管线只处理伤害（delta<0），治疗（delta>0）保持原样。
 */

import { globalModStore } from './e2Helpers';
import type { Modifier } from './types';

/** 伤害管线输入 */
export interface DamagePipelineInput {
  /** 原本接受伤害的单位 id */
  targetUnitId: string;
  /** 伤害量（正数） */
  damage: number;
  /** 伤害源（用于自损判断；可选，没有就当作外部伤害） */
  attackerId?: string;
  /** 触发原因字符串（用于自损识别，例如 "逆·天地崩·自损"） */
  reason?: string;
  /** 当前所有相关单位的 hp 状态：用于 hp_floor 计算 */
  currentHp: number;
}

/** 伤害管线输出 */
export interface DamagePipelineOutput {
  /** 经过 redirect 后真正受伤的单位 id */
  finalTargetId: string;
  /** 经过 reduce 后真正扣的伤害（>=0；如 hp_floor 触发则会进一步收缩） */
  finalDamage: number;
  /** 是否发生了重定向（用于战报提示） */
  redirected: boolean;
  /** 减免量（log 用） */
  reducedBy: number;
  /** 是否触发 hp_floor（log 用） */
  hpFloorTriggered: boolean;
  /** 重定向后目标的 hp 上限/下限（用于 caller 算出新 hp） */
  redirectFloorValue?: number;
}

/** 判断是否为自损/自残行为 */
function isSelfHarm(input: DamagePipelineInput): boolean {
  if (input.attackerId && input.attackerId === input.targetUnitId) return true;
  const r = input.reason ?? '';
  if (r.includes('自损') || r.includes('自残') || r.includes('自爆')) return true;
  return false;
}

/**
 * 应用伤害管线
 *
 * @param input 受伤前快照
 * @param getUnitHp 给定 unitId 返回其当前 hp（用于 redirect 后计算新目标 hp）
 * @returns 经过管线处理后的最终伤害落点
 */
export function applyDamagePipeline(
  input: DamagePipelineInput,
  getUnitHp: (unitId: string) => number | undefined,
): DamagePipelineOutput {
  let finalTargetId = input.targetUnitId;
  let damage = Math.max(0, input.damage);
  let redirected = false;
  let reducedBy = 0;
  let hpFloorTriggered = false;

  // ① damage_redirect（自损不参与）
  if (!isSelfHarm(input) && damage > 0) {
    const redirectMods = globalModStore.query(input.targetUnitId, 'damage_redirect');
    if (redirectMods.length > 0) {
      // 取首个有效 redirect modifier（按 priority 已排序）
      const m = redirectMods[0] as Modifier;
      const p = m.payload as { redirectTo?: string };
      if (p?.redirectTo && p.redirectTo !== input.targetUnitId) {
        const redirectTargetHp = getUnitHp(p.redirectTo);
        if (typeof redirectTargetHp === 'number' && redirectTargetHp > 0) {
          finalTargetId = p.redirectTo;
          redirected = true;
        }
      }
    }
  }

  // ② damage_reduce（按 finalTargetId 查；薰儿本体绝技给所有友军挂同一种）
  if (damage > 0) {
    const reduceMods = globalModStore.query(finalTargetId, 'damage_reduce');
    let totalReduce = 0;
    let floor = 1; // 默认最低为 1（契约 Q11② 兜底）
    for (const m of reduceMods as Modifier[]) {
      const p = m.payload as { value?: number; floor?: number };
      if (typeof p.value === 'number') totalReduce += p.value;
      if (typeof p.floor === 'number') floor = Math.max(floor, 0); // 取最大 floor 以保护
      // 实际策划意图：floor 是"减免后伤害最低 = floor"
      if (typeof p.floor === 'number') floor = p.floor;
    }
    if (totalReduce > 0) {
      const after = Math.max(floor, damage - totalReduce);
      reducedBy = damage - after;
      damage = after;
    }
  }

  // ③ hp_floor（如薰儿觉醒：薰儿 hp 最低=1）
  let redirectFloorValue: number | undefined;
  if (damage > 0) {
    const floorMods = globalModStore.query(finalTargetId, 'hp_floor');
    if (floorMods.length > 0) {
      // 取所有 hp_floor 中最高的 value（最严格的保护）
      let hpFloor = -Infinity;
      for (const m of floorMods as Modifier[]) {
        const p = m.payload as { value?: number };
        if (typeof p.value === 'number' && p.value > hpFloor) hpFloor = p.value;
      }
      if (hpFloor > -Infinity) {
        // 计算"如果按当前 damage 扣会变成多少"
        const baseHp = redirected ? (getUnitHp(finalTargetId) ?? input.currentHp) : input.currentHp;
        const projected = baseHp - damage;
        if (projected < hpFloor) {
          // 触底：实际只能扣 (baseHp - hpFloor)
          const allowed = Math.max(0, baseHp - hpFloor);
          if (allowed < damage) {
            damage = allowed;
            hpFloorTriggered = true;
            redirectFloorValue = hpFloor;
          }
        }
      }
    }
  }

  return {
    finalTargetId,
    finalDamage: damage,
    redirected,
    reducedBy,
    hpFloorTriggered,
    redirectFloorValue,
  };
}
