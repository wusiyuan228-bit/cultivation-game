/**
 * 【肖璇 / 斗帝·天焱三决】通用SSR · 绝技
 * 策划原文：主动发动，刷新3名指定角色的绝技使用次数
 * Q46：仅限友军
 */
import type { Modifier, SkillRegistration } from '../types';
import { PRIORITY } from '../types';

export const skill_xiaoxuan_tianyan: SkillRegistration = {
  id: 'ssr_xiaoxuan.ult',
  name: '斗帝·天焱三决',
  description: '主动发动，刷新3名友军的绝技使用次数',
  isActive: true,
  targetSelector: { kind: 'single_any_character' },
  maxCasts: 1,
  precheck: (self, engine) => {
    const allies = engine
      .getAlliesOf(self)
      .filter((u) => u.isAlive && u.ultimateUsed);
    if (allies.length === 0) return { ok: false, reason: '无已消耗绝技的友军' };
    return { ok: true, candidateIds: allies.map((u) => u.id) };
  },
  activeCast: (self, _targetIds, engine) => {
    // MVP：直接选 ultimateUsed 的友军前 3 名
    const allies = engine
      .getAlliesOf(self)
      .filter((u) => u.isAlive && u.ultimateUsed)
      .slice(0, 3);
    if (allies.length === 0) return { consumed: false };

    engine.emit(
      'skill_active_cast',
      { skillId: 'ssr_xiaoxuan.ult', count: allies.length },
      `「斗帝·天焱三决」发动，刷新 ${allies.length} 名友军绝技（自动选择 · 前3个绝技已用的友军）`,
      {
        actorId: self.id,
        targetIds: allies.map((u) => u.id),
        skillId: 'ssr_xiaoxuan.ult',
        severity: 'climax',
      },
    );
    for (const a of allies) {
      const mod: Modifier = {
        id: `tianyan_refresh_${a.id}_${engine.getRound()}`,
        sourceSkillId: 'ssr_xiaoxuan.ult',
        sourceUnitId: self.id,
        category: 'permanent',
        targetUnitId: a.id,
        kind: 'ultimate_refreshed',
        payload: {},
        duration: { type: 'permanent_in_battle' },
        priority: PRIORITY.TEMPORAL,
      };
      engine.attachModifier(mod);
      // 直接重置 ultimateUsed（由引擎层的 modifier 机制消费）
      a.ultimateUsed = false;
      engine.emit(
        'modifier_applied',
        { skillId: 'ssr_xiaoxuan.ult' },
        `${a.name} 的绝技使用次数已刷新`,
        { actorId: self.id, targetIds: [a.id], skillId: 'ssr_xiaoxuan.ult', severity: 'highlight' },
      );
    }
    return { consumed: true };
  },
  hooks: {},
};
