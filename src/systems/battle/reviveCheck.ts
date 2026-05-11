/**
 * 复活机制统一处理（2026-05-11）
 *
 * 问题背景：
 *   徐立国的"天罡元婴·重塑"绝技要求第一次死亡时原地复活。
 *   引擎层的 on_self_death hook 已实装，但 3 套 store（battleStore/s7bBattleStore/s7dBattleStore）
 *   都使用自己的 fireHooks 而不调用 engine.resolveAttack，因此 hook 永远不会被派发。
 *
 * 方案：
 *   提供一个统一的 `tryRevive` 函数，在 store 死亡判定的位置调用。
 *   如果该单位有"复活类绝技"且未触发过，则修改 unit 字段实现"复活拦截"。
 *
 * 接入点：
 *   - battleStore.ts 第 ~742 行（剿匪/S5 攻击死亡判定）
 *   - s7bBattleStore.ts 第 ~1207 行（宗门 2v2/3v3）
 *   - s7dBattleStore.ts changeStat 中 newHp <= 0 时（坠魔谷决战）
 *
 * 设计要点：
 *   - 玩家方：弹窗让玩家分配 8 点到 atk/mnd/hp
 *   - AI 方：自动 atk=3, mnd=2, hp=3
 *   - 标记 ultimateUsed = true（本场只能复活一次）
 *
 * 数据契约：
 *   `revivableUnit` 必须有 hp / atk / mnd / hpMax / dead / skills(optional) 等基本字段
 *   返回 { revived: boolean, payload?: { hp, atk, mnd } }
 */

/** 判断该单位是否拥有"重塑"复活类绝技且尚未触发过 */
export function shouldTryRevive(unit: {
  ultimateId?: string | null;
  ultimateUsed?: boolean;
  ultimate?: { name?: string } | null;
  registrySkills?: string[];
}): boolean {
  if (unit.ultimateUsed) return false;
  // 通过 registrySkills 中是否包含 sr_xuliguo.ultimate 来判定
  // （rs 后续如果新增类似复活技能，只需在此扩展白名单）
  const reviveSkillIds = new Set([
    'sr_xuliguo.ultimate', // 徐立国 · 天罡元婴·重塑
  ]);
  if (unit.registrySkills && unit.registrySkills.some((s) => reviveSkillIds.has(s))) {
    return true;
  }
  // 兜底：通过绝技名称判定（registrySkills 可能尚未填充）
  if (unit.ultimate?.name === '天罡元婴·重塑') return true;
  return false;
}

/** 默认 AI 复活分配（atk=3, mnd=2, hp=3，总数 8） */
export const DEFAULT_REVIVE_PAYLOAD = { hp: 3, atk: 3, mnd: 2 } as const;

export interface RevivePayload {
  hp: number;
  atk: number;
  mnd: number;
}

/** 校验复活分配合法性：每项 ≥ 1，总数 = 8 */
export function isValidRevivePayload(p: RevivePayload): boolean {
  if (p.hp < 1 || p.atk < 1 || p.mnd < 1) return false;
  return p.hp + p.atk + p.mnd === 8;
}

/** 生成复活后的战报文案 */
export function reviveLogText(unitName: string, p: RevivePayload, source: 'auto' | 'player' = 'auto'): string {
  const tag = source === 'player' ? '（玩家分配）' : '';
  return `✨ 天罡元婴·重塑：${unitName} 原地复活 → 修为 ${p.atk} / 心境 ${p.mnd} / 气血 ${p.hp}${tag}`;
}
