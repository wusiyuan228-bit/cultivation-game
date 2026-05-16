/**
 * 【司图楠 / 天逆珠·修炼】绑定SSR · 战斗技能（主动）
 *
 * 策划原文（2026-05-16 更新）：
 *   主动发动，可减少自身X点气血（X≤当前气血-1），让另1名友军：
 *     - 修为 +X
 *     - 心境 +X（心境最多 +2）
 *     - 生命 +X
 *   每回合限制发动一次（受全局 skillUsedThisTurn 约束，等同其它战技）。
 *   司图楠当前气血为 1 时无法发动（因 X ≥ 1 必须满足）。
 *
 * 契约登记：
 *   trigger  : active_variable
 *   effect   : self_sacrifice_buff_ally
 *   每回合限制 : 由 store 层 skillUsedThisTurn 提供（不在技能层 maxCasts 控制）
 *   X 上限   : self.hp.current - 1（保留至少 1 血）
 *   X 下限   : 1
 *   mnd 上限 : 单次 +2（保留原文）
 *
 * UI 交互（2026-05-16 接入弹窗）：
 *   1. 玩家点【天逆珠·修炼】按钮 → 进入瞄准态（高亮其他存活友军）
 *   2. 点选 1 名友军 → 弹出"选择消耗气血量"弹窗（1 ~ hp-1）
 *   3. 玩家选定 X 并确认 → 调用 performBattleSkillActive(unitId, [targetId], { x: X })
 *   4. activeCast 收到 X 参数后执行扣血/加属性
 *
 *   注：activeCast 第 4 个参数 ctx 由 store 层注入（非标准 SkillRegistration 字段，
 *       故沿用 targetIds[1] = `__X:5__` 这种带前缀字符串编码 X 值的"通道"约定）。
 *       约定见下方实现：targetIds = [targetId, `__X__${X}`]
 */
import type { SkillRegistration } from '../types';

const X_PREFIX = '__X__';

/** 编码 X 值进入 targetIds（UI 调用约定） */
export function encodeXiulianTargets(targetId: string, x: number): string[] {
  return [targetId, `${X_PREFIX}${x}`];
}

/** 从 targetIds 解析 X 值（不传则返回 null，触发兜底=最大化） */
function decodeX(targetIds: string[]): { targetId: string | null; X: number | null } {
  const targetId = targetIds[0] && !targetIds[0].startsWith(X_PREFIX) ? targetIds[0] : null;
  for (const t of targetIds) {
    if (typeof t === 'string' && t.startsWith(X_PREFIX)) {
      const n = Number(t.slice(X_PREFIX.length));
      if (Number.isFinite(n) && n >= 1) return { targetId, X: Math.floor(n) };
    }
  }
  return { targetId, X: null };
}

export const skill_situnan_xiulian: SkillRegistration = {
  id: 'bssr_situnan.battle',
  name: '天逆珠·修炼',
  description:
    '主动发动，可减少自身X点气血（X≤当前气血-1，X≥1），让另1名友军：修为+X、心境+X(最多+2)、生命+X。每回合限1次。',
  isActive: true,
  // single_any_character + UI 层按 ally 过滤；precheck 内部生成 candidateIds 供 UI 高亮
  targetSelector: { kind: 'single_any_character' },
  maxCasts: Infinity, // 技能层不限次；每回合一次由 store 的 skillUsedThisTurn 全局保证
  precheck: (self, engine) => {
    if (self.hp.current < 2) {
      return { ok: false, reason: '司图楠气血不足（需 ≥2 才能消耗 ≥1 点为友军灌注）' };
    }
    // 候选目标：同阵营 + 存活 + 非自身
    const allies = engine.getAlliesOf(self).filter((u: any) => u.isAlive && u.id !== self.id);
    if (allies.length === 0) {
      return { ok: false, reason: '场上无可灌注的友军' };
    }
    return { ok: true, candidateIds: allies.map((u: any) => u.id) };
  },
  activeCast: (self, targetIds, engine) => {
    const { targetId, X: paramX } = decodeX(targetIds);
    if (!targetId) {
      engine.emit(
        'skill_effect_blocked',
        { skillId: 'bssr_situnan.battle', reason: 'no_target' },
        `「天逆珠·修炼」发动失败——未指定目标`,
        { actorId: self.id, skillId: 'bssr_situnan.battle', severity: 'info' },
      );
      return { consumed: false };
    }
    const target = engine.getUnit(targetId);
    if (!target || !target.isAlive || target.owner !== self.owner || target.id === self.id) {
      engine.emit(
        'skill_effect_blocked',
        { skillId: 'bssr_situnan.battle', reason: 'invalid_target' },
        `「天逆珠·修炼」发动失败——目标必须为另1名友军`,
        { actorId: self.id, skillId: 'bssr_situnan.battle', severity: 'info' },
      );
      return { consumed: false };
    }

    // X 决策：UI 传入则用，否则兜底为最大化（hp-1）—— 兼容 AI 路径与历史调用
    const maxX = self.hp.current - 1;
    let X = paramX !== null ? paramX : maxX;
    // 双重约束：1 ≤ X ≤ hp-1
    if (X < 1) X = 1;
    if (X > maxX) X = maxX;
    if (X < 1) {
      engine.emit(
        'skill_effect_blocked',
        { skillId: 'bssr_situnan.battle', reason: 'X_zero' },
        `「天逆珠·修炼」发动失败——自身气血过低`,
        { actorId: self.id, skillId: 'bssr_situnan.battle', severity: 'info' },
      );
      return { consumed: false };
    }

    engine.emit(
      'skill_active_cast',
      { skillId: 'bssr_situnan.battle', X, targetId: target.id },
      `「天逆珠·修炼」发动：消耗 ${X} 点气血为 ${target.name} 灌注（修为+${X}/心境+${Math.min(X, 2)}/生命+${X}）`,
      { actorId: self.id, targetIds: [target.id], skillId: 'bssr_situnan.battle', severity: 'highlight' },
    );

    // 注：实际数值变更由 store 层执行（参见 s7bBattleStore.performBattleSkillActive 中
    //     针对 bssr_situnan.battle 的专用分支）。这里只做 emit + 返回参数。
    return {
      consumed: true,
      // 通过自定义字段把 X 传给 store 层；store 层据此执行 changeStat
      // （types.ts 的 ActiveCastResult 仅约束 consumed，故附加字段可被读取）
      payload: { X, targetId: target.id, casterId: self.id } as any,
    } as any;
  },
  hooks: {},
};
