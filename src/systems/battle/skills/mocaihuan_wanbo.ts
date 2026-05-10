/**
 * 【墨采寰 / 彩环万缚·极】通用SSR · 绝技
 * 策划原文：主动发动，进行一次心境判定（投心境值颗骰子），场上所有角色（含己方）受到（判定点数-2）的固定伤害
 * Q49：同步 Q11② 最低伤害 = 1
 */
import type { SkillRegistration } from '../types';

export const skill_mocaihuan_wanbo: SkillRegistration = {
  id: 'ssr_mocaihuan.ult',
  name: '彩环万缚·极',
  description: '主动发动，心境判定，场上所有角色（含己方）受(点数-2)固定伤害',
  isActive: true,
  targetSelector: { kind: 'none' },
  maxCasts: 1,
  precheck: () => ({ ok: true }),
  activeCast: (self, _targetIds, engine) => {
    // MVP：点数 = mnd × 3.5 取整
    const roll = Math.floor(self.mnd.current * 3.5);
    const damage = Math.max(1, roll - 2); // Q49 同 Q11②
    engine.emit(
      'skill_active_cast',
      { skillId: 'ssr_mocaihuan.ult', roll, damage },
      `「彩环万缚·极」发动，心境判定 ${roll}，伤害 ${damage}`,
      { actorId: self.id, skillId: 'ssr_mocaihuan.ult', severity: 'climax' },
    );
    const all = engine.getAllUnits().filter((u) => u.isAlive);
    for (const u of all) {
      engine.changeStat(u.id, 'hp', -damage, {
        permanent: false,
        reason: '彩环万缚·极',
        skillId: 'ssr_mocaihuan.ult',
      });
    }
    return { consumed: true };
  },
  hooks: {},
};
