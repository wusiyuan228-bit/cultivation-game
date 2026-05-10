/**
 * S7D · 战场战斗结算工具
 *
 * 对齐 S7B 的骰子玩法：
 *   - 攻方掷 atk 个六面骰
 *   - 防方掷 atk 个六面骰（修为对修为，与 S7A/S7B/S7C 一致）
 *   - 伤害 = max(0, 攻方点数和 - 防方点数和) + 技能/克制加成
 *   - 同时支持对水晶的攻击（水晶无防骰，直接扣 1 点 HP）
 *
 * 相邻判定（曼哈顿距离 = 1）
 *   - 棋子攻击棋子：必须相邻
 *   - 棋子攻击水晶：棋子所在格与水晶格相邻（或棋子就站在水晶格上）
 *
 * Batch 1 版本：
 *   - 不考虑五行克制（暂且保留接口，默认克制加成为 0）
 *   - 不考虑技能加成（默认 skillMod = 0）
 *   - Batch 2 接入技能系统时扩展
 */

import type { BattleCardInstance, BattleFaction, Crystal, GridPos } from '@/types/s7dBattle';

/**
 * 投 N 个 1-6 的骰子
 */
export function rollDice(count: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < Math.max(0, Math.floor(count)); i++) {
    result.push(1 + Math.floor(Math.random() * 6));
  }
  return result;
}

/**
 * 骰子结算结果
 */
export interface S7DDiceResult {
  attackerDice: number[];
  defenderDice: number[];
  attackerSum: number;
  defenderSum: number;
  /** 基础差值（攻方 - 防方，最低 0） */
  baseDamage: number;
  /** 技能加成（Batch 2 接入） */
  skillMod: number;
  /** 克制加成（Batch 2 接入） */
  counterMod: number;
  /** 最终伤害 */
  damage: number;
}

/**
 * 常规棋子互攻结算
 */
export function resolveUnitAttack(
  attacker: BattleCardInstance,
  defender: BattleCardInstance,
  opts?: { skillMod?: number; counterMod?: number },
): S7DDiceResult {
  const atkDice = rollDice(Math.max(1, attacker.atk));
  const defDice = rollDice(Math.max(0, defender.atk));
  const atkSum = atkDice.reduce((a, b) => a + b, 0);
  const defSum = defDice.reduce((a, b) => a + b, 0);
  const base = Math.max(0, atkSum - defSum);
  const skillMod = opts?.skillMod ?? 0;
  const counterMod = opts?.counterMod ?? 0;
  const damage = Math.max(0, base + skillMod + counterMod);
  return {
    attackerDice: atkDice,
    defenderDice: defDice,
    attackerSum: atkSum,
    defenderSum: defSum,
    baseDamage: base,
    skillMod,
    counterMod,
    damage,
  };
}

/**
 * @deprecated 水晶不可被主动攻击，规则 v2 改为站位结算。保留仅为兼容旧调用点。
 */
export function resolveCrystalAttack(
  _attacker: BattleCardInstance,
): { damage: number } {
  return { damage: 0 };
}

/**
 * 曼哈顿距离（相邻 = 1）
 */
export function manhattan(a: GridPos, b: GridPos): number {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
}

/**
 * 判断两单位是否相邻
 */
export function areUnitsAdjacent(a: BattleCardInstance, b: BattleCardInstance): boolean {
  if (!a.position || !b.position) return false;
  return manhattan(a.position, b.position) === 1;
}

/**
 * 判断某单位能否攻击某敌方单位（相邻 + 阵营不同 + 都存活 + 攻方本回合未攻击）
 */
export function canAttackUnit(
  attacker: BattleCardInstance,
  defender: BattleCardInstance,
): { ok: boolean; reason?: string } {
  if (attacker.hp <= 0) return { ok: false, reason: '攻方已阵亡' };
  if (defender.hp <= 0) return { ok: false, reason: '目标已阵亡' };
  if (attacker.faction === defender.faction) return { ok: false, reason: '不能攻击友方' };
  if (attacker.zone !== 'field' || defender.zone !== 'field')
    return { ok: false, reason: '单位不在战斗区' };
  if (!areUnitsAdjacent(attacker, defender)) return { ok: false, reason: '目标不相邻' };
  if (attacker.attackedThisTurn) return { ok: false, reason: '本回合已攻击' };
  if (attacker.stunned) return { ok: false, reason: '眩晕中' };
  return { ok: true };
}

/**
 * 判断某单位能否攻击某水晶
 *
 * ⚠️ 规则更新（v2）：
 *   水晶不可被主动攻击。扣水晶血的唯一方式是：我方棋子占据敌方水晶格，
 *   在大回合结束时结算，每个存活占领者扣 1 点水晶血。
 *
 * 本函数保留用于兼容旧调用点，永远返回 ok:false。
 */
export function canAttackCrystal(
  _attacker: BattleCardInstance,
  _crystal: Crystal,
): { ok: boolean; reason?: string } {
  return { ok: false, reason: '水晶不可被主动攻击，需通过占领水晶格在大回合末结算' };
}

/**
 * 获取某单位能攻击的所有敌方单位（返回实例列表）
 */
export function getAttackableEnemies(
  attacker: BattleCardInstance,
  allUnits: BattleCardInstance[],
): BattleCardInstance[] {
  return allUnits.filter((u) => canAttackUnit(attacker, u).ok);
}

/**
 * 获取某单位能攻击的水晶（通常最多 1 个——敌方那个）
 */
export function getAttackableCrystals(
  attacker: BattleCardInstance,
  crystalA: Crystal,
  crystalB: Crystal,
): Crystal[] {
  const targets: Crystal[] = [];
  if (canAttackCrystal(attacker, crystalA).ok) targets.push(crystalA);
  if (canAttackCrystal(attacker, crystalB).ok) targets.push(crystalB);
  return targets;
}
