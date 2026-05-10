/**
 * 【霄战 / 萧族护盾】绑定SR · 绝技
 *
 * 策划原文：主动发动，在地图任意位置布置1个阻碍物，任何人无法通过（永久存在）
 *
 * 契约登记：
 *   trigger  : active_once
 *   effect   : place_obstacle
 *   裁决 Q37 ：障碍物不可被位移技能影响（非角色，位移落点合法性过滤）
 *
 * 实装 MVP：
 *   obstacle 在 s7bBattleStore 的 board 上以独立字段存储；activeCast 写 logEntry + 由 store 层拾取
 *   该 ID=`obstacle_xiaozhan.{round}.{seq}` 可用于之后的 detachModifier/移除
 */
import type { SkillRegistration } from '../types';

export const skill_xiaozhan_zushudun: SkillRegistration = {
  id: 'bsr_xiaozhan.ult',
  name: '萧族护盾',
  description: '主动发动，在地图任意位置布置1个阻碍物，任何人无法通过（永久存在，直至战斗结束）',
  isActive: true,
  targetSelector: { kind: 'position_pick' }, // P2：玩家点击棋盘空格子决定落点；AI 走 store 层自动策略
  maxCasts: 1,
  precheck: () => ({ ok: true }),
  activeCast: (self, _targetIds, engine) => {
    // activeCast 只负责广播意图；真实落点写入由 store 层 performUltimate 根据 pickedPosition 处理
    engine.emit(
      'skill_active_cast',
      { skillId: 'bsr_xiaozhan.ult' },
      `「萧族护盾」发动，准备布置阻碍物`,
      { actorId: self.id, skillId: 'bsr_xiaozhan.ult', severity: 'climax' },
    );
    return { consumed: true };
  },
  hooks: {},
};
