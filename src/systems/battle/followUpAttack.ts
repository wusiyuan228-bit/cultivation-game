/**
 * 公共绝技后置攻击展开 helper（2026-05-11 架构升级）
 *
 * 各 store（battleStore / s7bBattleStore / s7dBattleStore）的 performUltimate
 * 在 activeCast 返回 consumed=true 后，统一调用 runFollowUpAttack 来"接续真实攻击"。
 *
 * 这样新增/修改"瞄准型攻击绝技"只需在技能文件里声明 followUpAttack 字段即可，
 * 不再需要修改 3 个 store 的白名单。
 *
 * 受益场景：
 *   ① 千仞雪·天使圣剑（atk+4 攻击）
 *   ② 纳兰嫣然·风暴裂斩（atk+2 攻击）
 *   ③ 唐昊·破天（atk+5 攻击）
 *   ④ 萧炎·佛怒火莲（AOE 相邻多段）
 *   ⑤ 唐三·万毒淬体（十字多段+atk-1 debuff）
 *   ⑥ 修罗唐三·弑神击（atk×2 单体）
 *   ⑦ 韩立·万剑归宗（atk×2 同行同列）
 *   ⑧ 马红俊·凤凰火雨（AOE 多段）
 */

import type { SkillRegistration } from './types';

/** store 必须提供的最小接口 —— 不暴露内部 unit 类型，只走 string id 与 callback */
export interface FollowUpAttackCtx {
  /** 当前所有单位（每段攻击会重新查询） */
  getUnits: () => Array<{ id: string; isDead: boolean; atk: number }>;
  /** 临时改写某单位的 atk 值（diceOverride 用） */
  setUnitAtk: (unitId: string, newAtk: number) => void;
  /** 触发一次攻击（与 store 自身的 attack() 同义，会走完整 resolveAttack 流程） */
  attack: (attackerId: string, targetId: string) => void;
  /** 永久 mutate 单位（postHit 用，立刻写回 store） */
  mutateUnit: (unitId: string, mutator: (u: any) => void) => void;
  /** 写一条战报 */
  addLog: (text: string, type?: 'system' | 'skill' | 'damage' | 'kill' | 'action') => void;
}

/**
 * 统一展开"绝技后置攻击"。
 *
 * @param skill   技能注册条目（必须带 followUpAttack 才会执行；否则直接 no-op）
 * @param attackerId 施法者 id
 * @param effectiveTargetIds AOE 已展开的目标列表（precheck.candidateIds 自动填充）
 * @param ctx     store 适配器
 *
 * @returns 已展开的攻击次数（0 表示 no-op 或 skill 没声明 followUpAttack）
 */
export function runFollowUpAttack(
  skill: SkillRegistration,
  attackerId: string,
  effectiveTargetIds: string[],
  ctx: FollowUpAttackCtx,
): number {
  const fua = skill.followUpAttack;
  if (!fua) return 0;

  const targets =
    fua.perTarget === true
      ? effectiveTargetIds.slice()
      : effectiveTargetIds.slice(0, 1);

  let count = 0;
  for (const tid of targets) {
    // 检查双方仍然在场
    const units = ctx.getUnits();
    const attacker = units.find((u) => u.id === attackerId);
    const target = units.find((u) => u.id === tid);
    if (!attacker || attacker.isDead) break;
    if (!target || target.isDead) continue;

    // diceOverride：临时改写 atk（实现"额外投 X 骰"语义）
    let restoreAtk: number | null = null;
    if (fua.diceOverride) {
      const override = fua.diceOverride({
        atk: { current: attacker.atk } as any,
      } as any);
      restoreAtk = attacker.atk;
      ctx.setUnitAtk(attackerId, override);
    }

    // 执行真正的 attack
    ctx.attack(attackerId, tid);
    count += 1;

    // 还原 atk（即便 attack 走完，self 仍在场上才还原）
    if (restoreAtk !== null) {
      const after = ctx.getUnits().find((u) => u.id === attackerId);
      if (after && !after.isDead) {
        ctx.setUnitAtk(attackerId, restoreAtk);
      }
    }

    // postHit：对目标做额外 mutation（如万毒淬体的 atk-1）
    if (fua.postHit) {
      ctx.mutateUnit(tid, (u) => {
        fua.postHit!(u, (text: string) => ctx.addLog(text, 'skill'));
      });
    }
  }

  return count;
}

/**
 * 检查 skill 是否声明了 followUpAttack（store 用于决定是否走通用路径）
 */
export function hasFollowUpAttack(skill: SkillRegistration): boolean {
  return !!skill.followUpAttack;
}
