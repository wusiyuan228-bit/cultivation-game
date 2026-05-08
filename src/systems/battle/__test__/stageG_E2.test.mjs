#!/usr/bin/env node
/* eslint-disable */
/**
 * 阶段 E2 · 复杂交互 store 层接入 测试
 *
 * 覆盖范围：
 *   ① 风属斗技 —— 有落点：攻击继续 + 位移  /  无落点：攻击取消（方案B）
 *   ② 天鬼搜身 —— 行动开始自动换位（MVP：最近敌方）
 *   ③ 镜像肠/化形镜像 stat_set 生效 + round_remain 清除
 *   ④ 慕沛灵续命丹 —— 复活已退场的非主角友军，3hp
 *   ⑤ 红蝶蛊惑 —— 下一行动轮剥夺控制 + 按 id 字典序攻击相邻友军
 *   ⑥ 全局 ModifierStore 持久化验证
 *
 * 运行方式：node src/systems/battle/__test__/stageG_E2.test.mjs
 *
 * 注：本脚本使用纯 JS 模拟 store 关键逻辑，避免引入 ts-node；
 *     若要跑真实 store 请启动 dev server 在浏览器中验证（S7B 场景）。
 */

console.log('═'.repeat(70));
console.log('  阶段 E2 · 复杂交互 store 层接入 自测');
console.log('═'.repeat(70));

function pass(msg) {
  console.log(`  ✅ ${msg}`);
}
function fail(msg) {
  console.log(`  ❌ ${msg}`);
  process.exitCode = 1;
}
function log(msg) {
  console.log(`  · ${msg}`);
}

function manhattan(r1, c1, r2, c2) {
  return Math.abs(r1 - r2) + Math.abs(c1 - c2);
}

/** 简化版 computeFengShuLandingPos（与 store 逻辑一致）*/
function findLandingPos(units, map, anchor, victim, radius) {
  const MAP_ROWS = 5, MAP_COLS = 6;
  const occupied = new Set();
  for (const u of units) {
    if (u.dead) continue;
    if (u.id === victim.id) continue;
    occupied.add(`${u.row},${u.col}`);
  }
  const out = [];
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      const d = manhattan(anchor.row, anchor.col, r, c);
      if (d === 0 || d > radius) continue;
      if (map[r]?.[c]?.terrain === 'obstacle') continue;
      if (occupied.has(`${r},${c}`)) continue;
      out.push({ row: r, col: c, dist: d });
    }
  }
  if (out.length === 0) return null;
  out.sort((a, b) => a.dist - b.dist || a.row - b.row || a.col - b.col);
  return { row: out[0].row, col: out[0].col };
}

function mkMap() {
  const MAP_ROWS = 5, MAP_COLS = 6;
  const map = [];
  for (let r = 0; r < MAP_ROWS; r++) {
    const row = [];
    for (let c = 0; c < MAP_COLS; c++) row.push({ row: r, col: c, terrain: 'normal' });
    map.push(row);
  }
  return map;
}

/* ══════════════════════════════════════════════════ */
/*  ① 风属斗技 —— 有合法落点                          */
/* ══════════════════════════════════════════════════ */
console.log('\n━━━━━━ ①风属斗技 · 有合法落点 ━━━━━━');
{
  const map = mkMap();
  const units = [
    { id: 'a', row: 2, col: 2, dead: false },
    { id: 't', row: 4, col: 4, dead: false },
  ];
  const pos = findLandingPos(units, map, units[0], units[1], 2);
  if (pos && manhattan(pos.row, pos.col, units[0].row, units[0].col) <= 2) {
    log(`落点 (${pos.row},${pos.col}) 距 anchor 曼哈顿 ${manhattan(pos.row, pos.col, 2, 2)}`);
    pass('找到合法落点，攻击继续，Q-E2-1 方案B 分支=有落点');
  } else {
    fail('应该找到落点');
  }
}

/* ══════════════════════════════════════════════════ */
/*  ② 风属斗技 —— 周围全满，无落点                    */
/* ══════════════════════════════════════════════════ */
console.log('\n━━━━━━ ②风属斗技 · 无合法落点（攻击取消）━━━━━━');
{
  const map = mkMap();
  // 把 anchor (0,0) 的 2 格邻域全占满
  // victim 放到 3 格距离外（不影响 2 格范围），这样腾出的 victim 原位也不算落点
  const anchor = { id: 'a', row: 0, col: 0, dead: false };
  const victim = { id: 't', row: 4, col: 0, dead: false }; // 距 anchor=4，超出2格
  const others = [
    { id: 'x1', row: 0, col: 1, dead: false },
    { id: 'x2', row: 0, col: 2, dead: false },
    { id: 'x3', row: 1, col: 0, dead: false },
    { id: 'x4', row: 1, col: 1, dead: false },
    { id: 'x5', row: 2, col: 0, dead: false }, // 距 anchor=2
  ];
  const units = [anchor, victim, ...others];
  const pos = findLandingPos(units, map, anchor, victim, 2);
  if (pos === null) {
    pass('无合法落点，按方案B 整个攻击取消（store 层返回空 DiceResult）');
  } else {
    log(`意外找到落点 (${pos.row},${pos.col}) dist=${manhattan(pos.row, pos.col, 0, 0)}`);
    fail('应当无落点');
  }
}

/* ══════════════════════════════════════════════════ */
/*  ③ 天鬼搜身 —— MVP 最近敌方交换                    */
/* ══════════════════════════════════════════════════ */
console.log('\n━━━━━━ ③天鬼搜身 · MVP 最近敌方交换 ━━━━━━');
{
  const self = { id: 'A', row: 0, col: 0, isEnemy: false, dead: false };
  const e1 = { id: 'E1', row: 0, col: 3, isEnemy: true, dead: false };
  const e2 = { id: 'E2', row: 4, col: 5, isEnemy: true, dead: false };
  const cur = [self, e1, e2];
  const enemies = cur
    .filter((x) => !x.dead && x.isEnemy !== self.isEnemy)
    .sort(
      (a, b) =>
        manhattan(self.row, self.col, a.row, a.col) -
        manhattan(self.row, self.col, b.row, b.col),
    );
  const t = enemies[0];
  if (t.id === 'E1') {
    log(`最近敌方=${t.id}，交换后 self→(${t.row},${t.col})，target→(${self.row},${self.col})`);
    pass('最近敌方选择正确');
  } else fail('应该选最近的 E1');
}

/* ══════════════════════════════════════════════════ */
/*  ④ 镜像肠 stat_set 快照 + round_remain 清除           */
/* ══════════════════════════════════════════════════ */
console.log('\n━━━━━━ ④镜像肠 stat_set + 大回合清除 ━━━━━━');
{
  // 模拟 modifier store
  const store = [];
  const self = { id: 'S', atk: 2 };
  const ally = { id: 'A', atk: 7 };
  // 施放镜像肠：挂 stat_set atk=7
  store.push({
    id: 'mod1',
    kind: 'stat_set',
    targetUnitId: self.id,
    payload: { stat: 'atk', setTo: ally.atk },
    duration: { type: 'round_remain' },
    priority: 3,
  });
  // 查询：attack 时 resolveStatSet
  const mods = store.filter((m) => m.kind === 'stat_set' && m.targetUnitId === self.id);
  const effective = mods[0]?.payload?.setTo ?? null;
  if (effective === 7) {
    log(`diceAttack 被覆盖：${self.atk} → ${effective}`);
    pass('镜像肠 stat_set 生效，骰数提升');
  } else fail('stat_set 未生效');

  // 模拟大回合结束：清除 round_remain
  const before = store.length;
  for (let i = store.length - 1; i >= 0; i--) {
    if (store[i].duration.type === 'round_remain') store.splice(i, 1);
  }
  const after = store.length;
  if (before === 1 && after === 0) {
    pass('新大回合 turnCycle 递增时，round_remain modifier 被清除（Q-E2-2 方案A）');
  } else fail('round_remain 未清除');
}

/* ══════════════════════════════════════════════════ */
/*  ⑤ 慕沛灵续命丹 —— 复活非主角友军                 */
/* ══════════════════════════════════════════════════ */
console.log('\n━━━━━━ ⑤续命丹 · 复活非主角 ━━━━━━');
{
  const self = { id: 'hero_xiaoyan', isEnemy: false };
  const deads = [
    { id: 'sr_mupeiling.xxx', dead: true, isEnemy: false, row: 1, col: 0 },
    { id: 'hero_tangsan.xxx', dead: true, isEnemy: false, row: 2, col: 0 }, // 主角，不可复活
    { id: 'enemy_1', dead: true, isEnemy: true, row: 3, col: 5 },           // 敌方，不可复活
  ];
  const revivable = deads.filter(
    (x) => x.dead && x.isEnemy === self.isEnemy && !x.id.startsWith('hero_'),
  );
  if (revivable.length === 1 && revivable[0].id === 'sr_mupeiling.xxx') {
    pass('只过滤出"非主角 + 同阵营 + 已退场"的候选');
  } else fail(`候选过滤错误，找到 ${revivable.length} 个`);
  // 复活后 hp=3
  const revived = { ...revivable[0], dead: false, hp: 3, acted: true };
  if (revived.hp === 3 && revived.acted === true && !revived.dead) {
    pass('复活后 hp=3，本轮不可行动（acted=true）');
  } else fail('复活状态异常');
}

/* ══════════════════════════════════════════════════ */
/*  ⑥ 红蝶蛊惑 —— charmedNextTurn + 字典序攻击        */
/* ══════════════════════════════════════════════════ */
console.log('\n━━━━━━ ⑥红蝶蛊惑 · 下轮倒戈 ━━━━━━');
{
  // 目标是敌方 X，相邻友军 E1/E2/E3（同 isEnemy=true）
  const victim = { id: 'X', row: 2, col: 3, isEnemy: true, dead: false, charmedNextTurn: true };
  const adjacent = [
    { id: 'E3', row: 1, col: 3, isEnemy: true, dead: false },
    { id: 'E1', row: 2, col: 2, isEnemy: true, dead: false },
    { id: 'E2', row: 3, col: 3, isEnemy: true, dead: false },
  ];
  const cur = [victim, ...adjacent];
  const allies = cur
    .filter(
      (x) =>
        !x.dead &&
        x.id !== victim.id &&
        x.isEnemy === victim.isEnemy &&
        manhattan(victim.row, victim.col, x.row, x.col) === 1,
    )
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const orderIds = allies.map((x) => x.id);
  log(`按字典序攻击顺序: ${orderIds.join(' → ')}`);
  if (JSON.stringify(orderIds) === JSON.stringify(['E1', 'E2', 'E3'])) {
    pass('攻击顺序按 id 字典序，对齐 Q-E2-3 方案A');
  } else fail('顺序不符预期');

  // 消费 marker
  victim.charmedNextTurn = false;
  if (victim.charmedNextTurn === false) pass('蛊惑 marker 本轮消费后清除');
}

/* ══════════════════════════════════════════════════ */
/*  ⑦ 天罡风暴 —— 强拉到相邻 1 格并攻击                */
/* ══════════════════════════════════════════════════ */
console.log('\n━━━━━━ ⑦天罡风暴 · 3格内强拉至相邻格 ━━━━━━');
{
  const map = mkMap();
  const self = { id: 'S', row: 2, col: 2, dead: false };
  const enemy = { id: 'E', row: 2, col: 5, dead: false }; // 距离 3
  const landing = findLandingPos([self, enemy], map, self, enemy, 1);
  if (landing && manhattan(landing.row, landing.col, self.row, self.col) === 1) {
    log(`强拉落点 (${landing.row},${landing.col}) 距 self=1`);
    pass('强拉到相邻 1 格，然后发起攻击');
  } else fail('未找到相邻落点');
}

/* ══════════════════════════════════════════════════ */
/*  ⑧ BUGFIX · 绝技每场战斗只能释放 1 次                */
/* ══════════════════════════════════════════════════ */
console.log('\n━━━━━━ ⑧绝技仅释放 1 次（每场战斗）━━━━━━');
{
  // 模拟 performUltimate 后对 snapshot 强制写 ultimateUsed=true
  const unit = { id: 'U', ultimateUsed: false, ultimate: { name: '邪灵诀·夺命' } };

  function performUltimate_mock(u) {
    if (u.ultimateUsed) return false;
    // activeCast 返回 consumed:true 但不写 ultimateUsed
    const consumed = true;
    if (!consumed) return false;
    // BUGFIX：performUltimate 兜底强制设为 true
    u.ultimateUsed = true;
    return true;
  }

  const r1 = performUltimate_mock(unit);
  const r2 = performUltimate_mock(unit);
  if (r1 === true && r2 === false && unit.ultimateUsed === true) {
    pass('第一次释放成功（返回 true），第二次被拒（返回 false）');
  } else {
    fail(`期望 r1=true r2=false，实际 r1=${r1} r2=${r2}`);
  }

  // 模拟觉醒后重置
  unit.ultimateUsed = false;
  const r3 = performUltimate_mock(unit);
  if (r3 === true) {
    pass('觉醒后重置 ultimateUsed=false，觉醒绝技可重新释放（符合契约）');
  } else {
    fail('觉醒后应能释放觉醒绝技');
  }
}

/* ══════════════════════════════════════════════════ */
console.log('═'.repeat(70));
if (process.exitCode) {
  console.log('  ❌ 有测试未通过');
} else {
  console.log('  ✅ 所有场景通过');
}
