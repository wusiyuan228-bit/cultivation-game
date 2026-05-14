/**
 * 【凝蓉蓉 / 九宝琉璃·极光】通用SR · SR绝技
 * 原文：主动发动，选1名友军，永久将其气血上限改为9并回满（超过9的原上限保持不变）
 * trigger: active_once  effect: set_hp_cap
 *
 * 2026-05-14 修复：
 *   旧实现"target.hpCap = 9"只改了 mapUnitToEngine() 返回的临时对象，
 *   并未回写到 store snapshots 的 maxHp，导致 S7B/battleStore 路径下：
 *     - hp 加血段被旧 maxHp(=8) clamp 卡死，hp 不变
 *     - 即便变了，afterCast 写回时 maxHp 也没同步
 *   新实现：统一通过 engine.changeStat('hp', delta, { breakCap:true, permanent:true })
 *   驱动 hp 与 hpCap/maxHp 联动：
 *     · 引擎层 changeStat：opts.permanent=true && breakCap=true 时
 *       会把 base 提升到新 hp，并 u.hpCap = max(u.hpCap, newValue)
 *     · S7B/battleStore adapter changeStat：breakCap=true 时跳过 clamp，
 *       且 newVal > t.maxHp 时 t.maxHp = newVal（直接写到 snapshots，回写 store）
 *     · s7dSkillEngine adapter changeStat：同款语义（写 t.hpCap），
 *       writeEngineBackToInstance 把 eu.hpCap → inst.hpMax 一并回写
 */
import type { SkillRegistration, BattleUnit, IBattleEngine } from '../types';

export const skill_ningrongrong_jiguang: SkillRegistration = {
  id: 'sr_ningrongrong.ultimate',
  name: '九宝琉璃·极光',
  description: '选 1 名友军，永久将其 hpCap 改为 9 并回满（若原 hpCap ≥ 9 则仅回满）',
  isActive: true,
  maxCasts: 1,
  targetSelector: { kind: 'single_any_ally' },
  precheck: (self: BattleUnit, engine: IBattleEngine) => {
    if (!self.isAlive) return { ok: false, reason: '施法者已退场' };
    const allies = [self, ...engine.getAlliesOf(self)].filter((u) => u.isAlive);
    return allies.length > 0
      ? { ok: true, candidateIds: allies.map((u) => u.id) }
      : { ok: false, reason: '无可选友军' };
  },
  activeCast: (self: BattleUnit, targetIds: string[], engine: IBattleEngine) => {
    const target = engine.getUnit(targetIds[0]);
    if (!target) return { consumed: false };

    const oldCap = target.hpCap;
    const oldHp = target.hp.current;

    if (oldCap < 9) {
      // 主路径：把 hp 抬到 9，破上限同时永久抬 hpCap → 9
      const targetHp = 9;
      const delta = targetHp - oldHp; // 可能为正、零、或负（满血 oldCap=8、oldHp=8 时 delta=1）
      // 即便 delta=0（理论不会发生，因为 oldCap<9 且 oldHp<=oldCap<9），
      // 也通过 changeStat(+1) 抬一次 maxHp；保险起见用 max(1, delta) 兜底。
      const safeDelta = Math.max(1, delta);
      engine.changeStat(target.id, 'hp', safeDelta, {
        permanent: true,
        breakCap: true,
        reason: '九宝琉璃·极光：抬升上限至 9 并回满',
        skillId: 'sr_ningrongrong.ultimate',
      });
      engine.emit(
        'skill_effect_applied',
        { unitId: target.id, stat: 'hpCap', setTo: 9, oldCap, oldHp },
        `九宝琉璃·极光：${target.name} 气血上限 ${oldCap} → 9，并回满气血`,
        {
          actorId: self.id,
          targetIds: [target.id],
          skillId: 'sr_ningrongrong.ultimate',
          severity: 'climax',
        },
      );
    } else {
      // 兼容路径：原 hpCap ≥ 9，不降上限，仅在 hp < hpCap 时回满（不破上限）
      const delta = target.hpCap - target.hp.current;
      if (delta > 0) {
        engine.changeStat(target.id, 'hp', delta, {
          permanent: false,
          breakCap: false,
          reason: '九宝琉璃·极光：原上限 ≥ 9，仅回满气血',
          skillId: 'sr_ningrongrong.ultimate',
        });
      }
      engine.emit(
        'skill_effect_blocked',
        { skillId: 'sr_ningrongrong.ultimate', oldCap, oldHp },
        `九宝琉璃·极光：${target.name} 原 hpCap ${oldCap} ≥ 9，仅回满气血`,
        {
          actorId: self.id,
          targetIds: [target.id],
          skillId: 'sr_ningrongrong.ultimate',
          severity: 'info',
        },
      );
    }
    return { consumed: true };
  },
  hooks: {},
};
