/**
 * 【纳兰嫣然 / 风属斗技】通用SR · 战斗技能
 * 原文：进攻时，可将目标传送到自身相邻2格内任意位置（除阻挡地形外）
 * Q18 强制传送不受 disable_move 阻断；落点必须合法
 * MVP：仅挂 emit（真实传送需 store 层网格逻辑）
 */
import type { SkillRegistration, HookHandler } from '../types';

export const skill_nalanyanran_fengshu: SkillRegistration = {
  id: 'sr_nalanyanran.battle',
  name: '风属斗技',
  description: '进攻时可将目标传送到自身相邻 2 格内空位（强制传送）',
  hooks: {
    on_after_hit: ((ctx, engine) => {
      const self = engine.getUnit(ctx.attacker.id);
      const target = engine.getUnit(ctx.defender.id);
      if (!self || !target || !self.skills.includes('sr_nalanyanran.battle')) return;
      if (!target.isAlive) return;
      engine.emit(
        'skill_passive_trigger',
        { skillId: 'sr_nalanyanran.battle' },
        `风属斗技：${target.name} 被强制位移至 ${self.name} 附近（自动执行 · 当前被击目标）`,
        { actorId: self.id, targetIds: [target.id], skillId: 'sr_nalanyanran.battle', severity: 'highlight' },
      );
      // 真实位移由 store 层 handleTeleport 处理
      engine.emit(
        'position_change',
        { unitId: target.id, from: { row: target.row, col: target.col }, teleport: true },
        `${target.name} 被传送`,
        { actorId: self.id, targetIds: [target.id], skillId: 'sr_nalanyanran.battle', severity: 'info' },
      );
    }) as HookHandler,
  },
};
