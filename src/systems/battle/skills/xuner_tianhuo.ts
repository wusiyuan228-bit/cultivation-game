/**
 * 【薰儿 / 金帝天火阵】主角本体 · 绝技
 *
 * 契约登记：
 *   策划原文：主动发动，本大回合剩余时间内，所有友军受到的伤害-3
 *   trigger  : active_once
 *   effect   : global_damage_reduce
 *   duration : round_remain（大回合剩余）
 *   Q11② 裁决：减免后最低伤害 = 1
 *
 * 实装：给每个友军（含自身）挂一个 damage_reduce modifier，
 *       duration.type='round_remain'（大回合结束时由 cleanupOnRoundEnd 清除）
 *
 *       在 resolveAttack 中，目前 damage_reduce modifier 尚未被读取。
 *       阶段 B 这里先 push 到 store-local 的 calcLog 中 —— 但这需要存储层 engine 支持。
 *       暂时使用 attachModifier 挂载，等阶段 C resolveAttack 扩展读取即可。
 *
 *       【注意】本技能为 modifier-based，其真实减伤生效依赖后续实装 damage_reduce modifier
 *       在 resolveAttack 中的读取逻辑。阶段 B 先完成挂载侧。
 */
import type { SkillRegistration, TargetSelector, Modifier } from '../types';
import { PRIORITY } from '../types';
import { genModifierId } from '../modifierSystem';

export const skill_xuner_tianhuo: SkillRegistration = {
  id: 'hero_xuner.ultimate',
  name: '金帝天火阵',
  description: '主动发动，本大回合剩余时间内，所有友军受到的伤害-3（最低为1）',
  isActive: true,
  targetSelector: { kind: 'all_allies_incl_self' } satisfies TargetSelector,
  maxCasts: 1,
  hooks: {},
  precheck: (self, _engine) => {
    if (self.ultimateUsed) return { ok: false, reason: '绝技已使用' };
    return { ok: true };
  },
  activeCast: (self, _targetIds, engine) => {
    engine.emit(
      'skill_active_cast',
      { skillId: 'hero_xuner.ultimate' },
      `🛡 ${self.name} 发动【金帝天火阵】→ 本大回合所有友军受到伤害 -3`,
      {
        actorId: self.id,
        skillId: 'hero_xuner.ultimate',
        severity: 'climax',
      },
    );

    const friendlies = [self, ...engine.getAlliesOf(self)];
    for (const u of friendlies) {
      const mod: Modifier = {
        id: genModifierId('hero_xuner.ultimate'),
        sourceSkillId: 'hero_xuner.ultimate',
        sourceUnitId: self.id,
        category: 'temporal',
        targetUnitId: u.id,
        kind: 'damage_reduce',
        payload: { value: 3, floor: 1 },
        duration: { type: 'round_remain' },
        priority: PRIORITY.TEMPORAL,
      };
      engine.attachModifier(mod);
    }
    self.ultimateUsed = true;
    return { consumed: true };
  },
};
