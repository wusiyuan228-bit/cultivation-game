/**
 * 【涅槃·小舞儿 / 柔骨·缠魂】主角觉醒 · 战斗技能
 *
 * 契约登记：
 *   策划原文：主动发动，可控制场上任意1名角色移动1格
 *   trigger  : active_once
 *   effect   : force_move
 *   Q18 裁决：不受 disable_move 阻断；但位移落点必须合法（不能是障碍物或已占据格）
 *
 * 实装：
 *   - targetSelector: single_any_character（任意阵营）
 *   - activeCast 接收 targetIds = [targetId, directionKey]；
 *     directionKey 由 UI 层传入，对应 'up'/'down'/'left'/'right'
 *   - 引擎层不感知地图障碍（它是 store 层的概念），因此 柔骨·缠魂的
 *     地图合法性检查在 store 层（s7bBattleStore）完成；引擎层仅做状态改写。
 *
 * 注意：
 *   本阶段 C S7B 的 UI 层对"主动绝技的目标选择"只实现到"选目标"，方向选择
 *   会走一个二级弹窗。为保持阶段 C 的交付节奏：
 *   - 引擎层技能注册就位（供 UI 调用）
 *   - 但 S7B UI 暂不提供方向选择弹窗（阶段 D UI 大改时一并做）
 *   - 自动化测试通过直接传 [targetId, 'right'] 验证
 */
import type { SkillRegistration, TargetSelector } from '../types';

export const skill_xiaowu_aw_chanhun: SkillRegistration = {
  id: 'hero_xiaowu.awaken.battle',
  name: '柔骨·缠魂',
  description: '主动发动，可控制场上任意1名角色移动1格（含友军与敌军）',
  isActive: true,
  targetSelector: { kind: 'single_any_character' } satisfies TargetSelector,
  maxCasts: 1,
  hooks: {},
  precheck: (self, engine) => {
    if (self.ultimateUsed) return { ok: false, reason: '绝技已使用' };
    const others = engine.getAllUnits().filter((u) => u.isAlive && u.id !== self.id);
    if (others.length === 0) return { ok: false, reason: '场上无其它单位' };
    return { ok: true, candidateIds: others.map((u) => u.id) };
  },
  activeCast: (self, targetIds, engine) => {
    const tid = targetIds[0];
    const direction = targetIds[1] as 'up' | 'down' | 'left' | 'right' | undefined;
    const target = tid ? engine.getUnit(tid) : undefined;
    if (!target) return { consumed: false };

    engine.emit(
      'skill_active_cast',
      { skillId: 'hero_xiaowu.awaken.battle', targetId: target.id, direction },
      `🕸 ${self.name} 发动【柔骨·缠魂】→ 牵引 ${target.name}${direction ? ` 向${{ up: '上', down: '下', left: '左', right: '右' }[direction]}` : ''} 移动 1 格`,
      {
        actorId: self.id,
        targetIds: [target.id],
        skillId: 'hero_xiaowu.awaken.battle',
        severity: 'climax',
      },
    );

    // 引擎层不做位置合法性校验（由 store 层或 UI 层在调用前确保）
    // 若调用方未传方向，引擎层不做任何位移，仅发射 log
    if (direction) {
      const dr = direction === 'up' ? -1 : direction === 'down' ? 1 : 0;
      const dc = direction === 'left' ? -1 : direction === 'right' ? 1 : 0;
      const oldR = target.row, oldC = target.col;
      target.row = oldR + dr;
      target.col = oldC + dc;
      engine.emit(
        'position_change',
        { targetId: target.id, from: [oldR, oldC], to: [target.row, target.col] },
        `   ${target.name} 位置 (${oldR},${oldC}) → (${target.row},${target.col})`,
        {
          targetIds: [target.id],
          skillId: 'hero_xiaowu.awaken.battle',
          severity: 'highlight',
        },
      );
    }

    self.ultimateUsed = true;
    return { consumed: true };
  },
};
