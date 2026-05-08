/**
 * 【斗帝血脉·薰儿 / 古族祖灵结界】主角觉醒 · 绝技
 *
 * 契约登记：
 *   策划原文：主动发动，本大回合剩余时间内，所有友军受到的伤害全部转移给薰儿承受，
 *            且薰儿气血最低降至1
 *   trigger  : active_once
 *   effect   : damage_redirect + hp_floor（三阶段模型，见契约 §5.1 ⑥⑧）
 *   Q11 裁决：三阶段模型 + 穿透名单
 *   Q23 裁决：duration = round_remain（大回合剩余，round_end 时 expired）
 *
 * 实装策略（阶段 C 骨架版）：
 *   - 给所有友军（含薰儿本人）挂 damage_redirect modifier → 重定向至薰儿
 *   - 给薰儿挂 hp_floor modifier → 最低气血=1
 *   - modifier 在 round_end 时由 cleanupOnRoundEnd 统一清除
 *
 * 真实的"重定向生效"与"hp=1 触底吸收"逻辑，需要 resolveAttack 层识别 damage_redirect
 * 和 hp_floor modifier。同 xuner_tianhuo（金帝天火阵）一样，阶段 C 完成挂载侧；
 * 真实结算由阶段 D 的 resolveAttack 扩展实装。
 */
import type { SkillRegistration, TargetSelector, Modifier } from '../types';
import { PRIORITY } from '../types';
import { genModifierId } from '../modifierSystem';

export const skill_xuner_aw_jieje: SkillRegistration = {
  id: 'hero_xuner.awaken.ultimate',
  name: '古族祖灵结界',
  description: '主动发动，本大回合剩余时间内，所有友军受到的伤害全部转移给薰儿承受，且薰儿气血最低降至1',
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
      { skillId: 'hero_xuner.awaken.ultimate' },
      `🛡 ${self.name} 发动【古族祖灵结界】→ 本大回合友军伤害全转嫁给薰儿（薰儿气血最低=1）`,
      { actorId: self.id, skillId: 'hero_xuner.awaken.ultimate', severity: 'climax' },
    );

    const friendlies = [self, ...engine.getAlliesOf(self)];
    for (const u of friendlies) {
      const redirectMod: Modifier = {
        id: genModifierId('hero_xuner.awaken.ultimate.redirect'),
        sourceSkillId: 'hero_xuner.awaken.ultimate',
        sourceUnitId: self.id,
        category: 'temporal',
        targetUnitId: u.id,
        kind: 'damage_redirect',
        payload: { redirectTo: self.id },
        duration: { type: 'round_remain' },
        priority: PRIORITY.TEMPORAL,
      };
      engine.attachModifier(redirectMod);
    }

    // 薰儿自己挂 hp_floor=1
    const floorMod: Modifier = {
      id: genModifierId('hero_xuner.awaken.ultimate.floor'),
      sourceSkillId: 'hero_xuner.awaken.ultimate',
      sourceUnitId: self.id,
      category: 'temporal',
      targetUnitId: self.id,
      kind: 'hp_floor',
      payload: { value: 1 },
      duration: { type: 'round_remain' },
      priority: PRIORITY.HP_FLOOR,
    };
    engine.attachModifier(floorMod);

    self.ultimateUsed = true;
    return { consumed: true };
  },
};
