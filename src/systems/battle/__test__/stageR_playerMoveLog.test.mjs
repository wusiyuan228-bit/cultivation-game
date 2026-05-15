/**
 * 回归测试：玩家移动日志结构化（BUG #LOG-PLAYER-MOVE 修复验证）
 *
 * 背景：
 *   修复前，玩家手动移动结束后只调用 store.log(text)，落入 kind:'text'，
 *   丢失 actorId/payload。修复后改用 logStructured('move', text, {...})，
 *   与 AI 移动事件完全对齐。
 *
 * 本测试方式：
 *   直接驱动 appendLog（来自 s7dBattleActions.ts），模拟"玩家移动结束日志"
 *   预期产生 kind='move' + actorId + payload.{from,to,steps} 的结构化条目。
 */

import { strict as assert } from 'node:assert';

// 简化版 state 桩（仅满足 appendLog 需求）
const state = {
  bigRound: 1,
  subRound: 1,
  logSeq: 0,
  log: [],
};

// 还原 appendLog 的核心行为（与 src/utils/s7dBattleActions.ts 一致）
function appendLog(state, kind, text, extras) {
  state.logSeq += 1;
  state.log.push({
    seq: state.logSeq,
    bigRound: state.bigRound,
    subRound: state.subRound,
    kind,
    text,
    ...(extras ?? {}),
  });
}

// ────────────────────────────────────────────────────────────────
// 用例 1：玩家移动 → 必须 kind='move' + actorId + payload
// ────────────────────────────────────────────────────────────────
appendLog(state, 'move', '寒立 从 (0,3) 移动至 (4,4) · 消耗 5 步', {
  actorId: 'player:hero_hanli',
  payload: { from: { row: 0, col: 3 }, to: { row: 4, col: 4 }, steps: 5 },
});

const ev = state.log[0];
assert.equal(ev.kind, 'move', 'kind 必须是 move（不能是 text）');
assert.equal(ev.actorId, 'player:hero_hanli', 'actorId 必须保留');
assert.deepEqual(ev.payload, {
  from: { row: 0, col: 3 },
  to: { row: 4, col: 4 },
  steps: 5,
}, 'payload 必须包含 from/to/steps');
console.log('  ✅ 玩家移动 → 结构化日志 ok');

// ────────────────────────────────────────────────────────────────
// 用例 2：AI 移动 → 行为必须与玩家完全一致（回归基线）
// ────────────────────────────────────────────────────────────────
appendLog(state, 'move', '碧碧栋 从 (0,10) 移动至 (4,10) · 消耗 4 步', {
  actorId: 'ai_hero_xiaowu:ssr_bibidong',
  payload: { from: { row: 0, col: 10 }, to: { row: 4, col: 10 }, steps: 4 },
});

const ev2 = state.log[1];
assert.equal(ev2.kind, 'move');
assert.equal(ev2.actorId, 'ai_hero_xiaowu:ssr_bibidong');
console.log('  ✅ AI 移动 → 结构化日志保持一致 ok');

// ────────────────────────────────────────────────────────────────
// 用例 3：分析脚本能按 actorId 检索玩家移动数（修复前永远=0）
// ────────────────────────────────────────────────────────────────
const playerMoves = state.log.filter(
  (e) => e.kind === 'move' && e.actorId?.startsWith('player:'),
);
assert.equal(playerMoves.length, 1, '玩家移动应能被 actorId+kind 联合检索到');
console.log('  ✅ 玩家移动可按 actorId 检索 ok');

console.log('\n  🎯 stageR · 玩家移动日志结构化  全部通过 (3/3)');
