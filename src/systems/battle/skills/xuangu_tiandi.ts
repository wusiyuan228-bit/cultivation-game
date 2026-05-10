/**
 * 【玄古 / 天地阴阳·逆】通用SSR · 绝技
 * 策划原文：主动发动，选定2个角色（敌或友均可），将其所有数值恢复到初始值
 * Q48：initialValue = 入场时的 StatBox.initial
 */
import type { SkillRegistration } from '../types';

export const skill_xuangu_tiandi: SkillRegistration = {
  id: 'ssr_xuangu.ult',
  name: '天地阴阳·逆',
  description: '主动发动，选2个角色，将其所有数值恢复到入场初始值',
  isActive: true,
  targetSelector: { kind: 'single_any_character' }, // UI 层扩展为多选
  maxCasts: 1,
  precheck: (self, engine) => {
    const all = engine.getAllUnits().filter((u) => u.isAlive);
    return { ok: all.length > 0, candidateIds: all.map((u) => u.id) };
  },
  activeCast: (self, targetIds, engine) => {
    // 支持 1-2 个目标
    const targets = targetIds
      .map((id) => engine.getUnit(id))
      .filter((u): u is NonNullable<typeof u> => !!u && u.isAlive)
      .slice(0, 2);
    if (targets.length === 0) return { consumed: false };

    engine.emit(
      'skill_active_cast',
      { skillId: 'ssr_xuangu.ult', count: targets.length },
      `「天地阴阳·逆」发动，${targets.length} 名角色数值归于初始`,
      {
        actorId: self.id,
        targetIds: targets.map((u) => u.id),
        skillId: 'ssr_xuangu.ult',
        severity: 'climax',
      },
    );
    for (const t of targets) {
      const hpDelta = t.hp.initial - t.hp.current;
      const atkDelta = t.atk.initial - t.atk.current;
      const mndDelta = t.mnd.initial - t.mnd.current;
      if (hpDelta === 0 && atkDelta === 0 && mndDelta === 0) {
        engine.emit(
          'skill_effect_blocked',
          { skillId: 'ssr_xuangu.ult', reason: 'no_change' },
          `「天地阴阳·逆」对 ${t.name} 无变化——各项已等于初始值`,
          { actorId: self.id, targetIds: [t.id], skillId: 'ssr_xuangu.ult', severity: 'info' },
        );
        continue;
      }
      if (hpDelta !== 0) {
        engine.changeStat(t.id, 'hp', hpDelta, {
          permanent: true,
          breakCap: true,
          reason: '天地阴阳·逆·重置',
          skillId: 'ssr_xuangu.ult',
        });
      }
      if (atkDelta !== 0) {
        engine.changeStat(t.id, 'atk', atkDelta, {
          permanent: true,
          breakCap: true,
          reason: '天地阴阳·逆·重置',
          skillId: 'ssr_xuangu.ult',
        });
      }
      if (mndDelta !== 0) {
        engine.changeStat(t.id, 'mnd', mndDelta, {
          permanent: true,
          breakCap: true,
          reason: '天地阴阳·逆·重置',
          skillId: 'ssr_xuangu.ult',
        });
      }
    }
    return { consumed: true };
  },
  hooks: {},
};
