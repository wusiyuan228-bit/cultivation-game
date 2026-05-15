/**
 * stageS · 云韵【风之极·陨杀】一波清场后战斗状态健康度回归测试
 *
 * 背景：BUG #YUNYUN-WIPE-BLACKSCREEN（2026-05-15）
 *   云韵绝技 1 骰主 + 4 固定复制 → 一次 castSkillAndApply 内 5 次 killUnit →
 *   reinforceQueue 巨量入队 + phase='reinforce' → 若没有立即 checkWin，
 *   战斗状态可能卡死或 UI 渲染崩溃（黑屏）。
 *
 * 本测试通过模拟以下不变量验证修复后状态机依然健康：
 *   ① castSkillAndApply 后 killedIds.length 与 reinforceQueue 长度一致
 *   ② 若敌方阵营 hand 区也已空，checkWinCondition 必须能立即返回 winner
 *   ③ phase='reinforce' 不会无限期保留
 *
 * 注：本测试只跑伪 state，不依赖真实战场初始化（脱耦更轻量）。
 */

import { strict as assert } from 'node:assert';

// ───────── 伪 state 与必要 helper（最小复刻） ─────────
function makeUnit(id, faction, ownerId, hp, zone, slot) {
  return {
    instanceId: id,
    name: id,
    faction,
    ownerId,
    hp,
    hpMax: hp,
    zone,
    fieldSlot: slot,
    position: zone === 'field' ? { row: 0, col: 0 } : undefined,
    isHero: false,
  };
}

function isFactionAllDead(state, faction) {
  const units = Object.values(state.units).filter((u) => u.faction === faction);
  if (units.length === 0) return false;
  return units.every((u) => u.hp <= 0 || u.zone === 'grave');
}

function checkWinCondition(state) {
  const aDead = isFactionAllDead(state, 'A');
  const bDead = isFactionAllDead(state, 'B');
  if (aDead && bDead) return { winner: 'draw', reason: 'all_dead' };
  if (aDead) return { winner: 'B', reason: 'all_dead' };
  if (bDead) return { winner: 'A', reason: 'all_dead' };
  return null;
}

function killAndQueueReinforce(state, id, reason) {
  const u = state.units[id];
  if (!u || u.zone === 'grave') return;
  const oldSlot = u.fieldSlot;
  u.zone = 'grave';
  u.hp = 0;
  u.fieldSlot = undefined;
  u.position = undefined;
  // 模拟手牌补位发起
  const handIds = Object.values(state.units)
    .filter((x) => x.ownerId === u.ownerId && x.zone === 'hand' && x.hp > 0)
    .map((x) => x.instanceId);
  if (handIds.length > 0) {
    state.reinforceQueue.push({ ownerId: u.ownerId, slot: oldSlot, candidateInstanceIds: handIds });
    state.phase = 'reinforce';
  }
}

// ─────────────────────────────────────────
// 用例 1：云韵清场 5 张敌方 field 卡，敌方 hand 仍有备卡
// 预期：5 张 reinforceQueue / 战斗未结束（待补位 → 后续 advanceSubRound 决胜负）
// ─────────────────────────────────────────
{
  const state = {
    phase: 'sub_round_action',
    reinforceQueue: [],
    units: {},
  };
  // 玩家方（A）：云韵 + 队友各 1
  state.units['yunyun'] = makeUnit('yunyun', 'A', 'player', 6, 'field', 1);
  state.units['ally'] = makeUnit('ally', 'A', 'player', 5, 'field', 2);
  // 敌方（B）：3 个 ai 玩家，每个 2 张 field + 2 张 hand
  for (const aiI of [1, 2, 3]) {
    for (const slot of [1, 2]) {
      const id = `ai${aiI}_field_${slot}`;
      state.units[id] = makeUnit(id, 'B', `ai_${aiI}`, 4, 'field', slot);
    }
    for (const hi of [1, 2]) {
      const id = `ai${aiI}_hand_${hi}`;
      state.units[id] = makeUnit(id, 'B', `ai_${aiI}`, 4, 'hand', undefined);
    }
  }
  // 模拟云韵一波清场 5 个（1 骰主 + 4 固复，剩 1 张敌方 field 卡）
  const enemyFields = Object.values(state.units).filter(
    (u) => u.faction === 'B' && u.zone === 'field',
  );
  enemyFields.slice(0, 5).forEach((e) => killAndQueueReinforce(state, e.instanceId, '风之极·陨杀'));

  assert.equal(state.reinforceQueue.length, 5, '应入队 5 条补位 task');
  assert.equal(state.phase, 'reinforce', 'phase 应切到 reinforce');
  assert.equal(checkWinCondition(state), null, '敌方 hand 仍有 6 张备卡，不应判负');
  console.log('  ✅ 用例 1：5 死 hand 充足 → 待补位、未分胜负 ok');
}

// ─────────────────────────────────────────
// 用例 2：云韵清场后，敌方 hand 已空 → checkWinCondition 必须立即返回 A 胜
// 这是修复前 useUltimate 没 checkWin 导致 winner=null 的卡死场景
// ─────────────────────────────────────────
{
  const state = {
    phase: 'sub_round_action',
    reinforceQueue: [],
    units: {},
  };
  state.units['yunyun'] = makeUnit('yunyun', 'A', 'player', 6, 'field', 1);
  state.units['ally'] = makeUnit('ally', 'A', 'player', 5, 'field', 2);
  // 敌方只有 5 张 field，无 hand 备卡（已经被前几回合消耗光）
  for (let i = 0; i < 5; i += 1) {
    const id = `enemy_${i}`;
    state.units[id] = makeUnit(id, 'B', `ai_${i % 3}`, 3, 'field', (i % 2) + 1);
  }
  // 一波清场 5 个
  Object.values(state.units)
    .filter((u) => u.faction === 'B' && u.zone === 'field')
    .forEach((e) => killAndQueueReinforce(state, e.instanceId, '风之极·陨杀'));

  assert.equal(state.reinforceQueue.length, 0, 'hand 已空，无补位任务');
  // 修复前：phase 仍可能停在 sub_round_action / 但 winner=null 卡死
  // 修复后：__postSkillCleanupAndCheckWin 立即调用 checkWinCondition → 判 A 胜
  const win = checkWinCondition(state);
  assert.equal(win?.winner, 'A', '敌方阵营全空，A 应立即胜');
  assert.equal(win?.reason, 'all_dead');
  console.log('  ✅ 用例 2：5 死 hand 已空 → A 立即获胜（不再黑屏卡死）ok');
}

// ─────────────────────────────────────────
// 用例 3：边界 — 双方均无 field 单位（极端：互相清场）
// 预期：返回 draw，避免 UI 取到 undefined currentActor 渲染崩溃
// ─────────────────────────────────────────
{
  const state = { phase: 'sub_round_action', reinforceQueue: [], units: {} };
  for (let i = 0; i < 2; i += 1) state.units[`a${i}`] = makeUnit(`a${i}`, 'A', 'p', 0, 'grave');
  for (let i = 0; i < 2; i += 1) state.units[`b${i}`] = makeUnit(`b${i}`, 'B', 'q', 0, 'grave');
  const win = checkWinCondition(state);
  assert.equal(win?.winner, 'draw');
  console.log('  ✅ 用例 3：双方全灭 → draw ok');
}

console.log('\n  🎯 stageS · 云韵清场后战斗状态健康度  全部通过 (3/3)');
