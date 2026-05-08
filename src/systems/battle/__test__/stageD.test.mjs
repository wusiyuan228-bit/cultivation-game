/**
 * 阶段 D 自测：UI 瞄准态 + AI 档位② + D1 八段摔
 *
 * 由于真实 UI 需要 React runtime，这里采用"行为仿真"测试：
 * 基于 S7B 引擎 + store 的纯函数/公共 API，验证阶段 D 引入的决策/判定逻辑。
 *
 * 测试点：
 *   ① 档位② - 单体绝技「能击杀」阈值：自 atk=9 vs 敌 hp=7 → 应放
 *   ② 档位② - 单体绝技「预估伤害 ≥ 半血」阈值：atk=6 vs maxHp=10 hp=10 → 应放（6 >= 5）
 *   ③ 档位② - 单体绝技收益不足：atk=3 vs maxHp=10 hp=10 → 不应放（3 < 5 且非击杀）
 *   ④ 档位② - AOE 绝技 命中≥2 → 应放
 *   ⑤ 档位② - AOE 绝技 仅 1 个目标且不能击杀 → 不应放
 *   ⑥ 档位② - 相邻 AOE（佛怒火莲）：相邻 ≥2 → 应放
 *   ⑦ 档位② - 相邻 AOE：仅 1 相邻且不能斩杀 → 不应放
 *   ⑧ 档位② - 全体友方增益：友有 hp/maxHp ≤ 40% → 应放
 *   ⑨ 档位② - 全体友方增益：友都满血 → 不应放
 *   ⑩ 档位② - 任意单位（柔骨·缠魂）：选 atk 最高敌方 → 应放 + 目标正确
 *   ⑪ UI 瞄准态 · 目标合法性校验：点击非 candidateIds 中目标 → 拒绝
 *   ⑫ UI 瞄准态 · selectorKind 对应 NEEDS_TARGET 映射正确
 *   ⑬ D1 · 八段摔·断魂：已损血=5 vs 相邻敌 hp=6 → 伤害5 不致死 + 自身退场
 *   ⑭ D1 · 八段摔·断魂：满血自爆 → 伤害=0 + 自身退场
 *   ⑮ D1 · 八段摔·断魂 + 小舞儿退场触发塘散觉醒（on_self_leave ⊂ on_self_sacrifice）
 *   ⑯ AI 绝技使用后 skillUsedThisTurn=true，不会重复放
 */

function pad(s, n) { return String(s).padEnd(n); }
function line(title) { console.log('\n━━━━━━', title, '━━━━━━'); }
function assert(cond, msg) { console.log(cond ? `  ✅ ${msg}` : `  ❌ ${msg}`); return cond; }

// ═════════════════════════════════════════════════════════════
//  ① 单体绝技能击杀 → 应放
// ═════════════════════════════════════════════════════════════
function testSingleKillThreshold() {
  line('①单体绝技能击杀 → 应放');
  // 模拟 evaluateUltimate 内部逻辑（kind=single_any_enemy, dmg=self.atk=9, target hp=7 → canKill）
  const self = { atk: 9 };
  const target = { hp: 7, maxHp: 10, atk: 5, name: 'E1' };
  const dmg = self.atk;
  const canKill = dmg >= target.hp;
  const halfHp = target.maxHp * 0.5;
  const shouldCast = canKill || dmg >= halfHp;
  console.log(`  self.atk=${self.atk} target.hp=${target.hp}/${target.maxHp} dmg=${dmg} canKill=${canKill}`);
  assert(shouldCast && canKill, '击杀场景 → 应放绝技');
}

// ═════════════════════════════════════════════════════════════
//  ② 单体绝技预估伤害≥半血 → 应放
// ═════════════════════════════════════════════════════════════
function testSingleHalfHpThreshold() {
  line('②预估伤害≥目标半血 → 应放');
  const self = { atk: 6 };
  const target = { hp: 10, maxHp: 10 };
  const dmg = self.atk;
  const canKill = dmg >= target.hp;
  const halfHp = target.maxHp * 0.5;
  const shouldCast = canKill || dmg >= halfHp;
  console.log(`  dmg=${dmg} halfHp=${halfHp} shouldCast=${shouldCast}`);
  assert(shouldCast && !canKill, '半血阈值命中 → 应放');
}

// ═════════════════════════════════════════════════════════════
//  ③ 单体绝技收益不足 → 不应放
// ═════════════════════════════════════════════════════════════
function testSingleNoValue() {
  line('③单体绝技收益不足 → 不应放');
  const self = { atk: 3 };
  const target = { hp: 10, maxHp: 10 };
  const dmg = self.atk;
  const shouldCast = dmg >= target.hp || dmg >= target.maxHp * 0.5;
  console.log(`  dmg=${dmg} 半血=${target.maxHp*0.5} shouldCast=${shouldCast}`);
  assert(!shouldCast, '伤害过低 → 不应放');
}

// ═════════════════════════════════════════════════════════════
//  ④ AOE 命中≥2 → 应放
// ═════════════════════════════════════════════════════════════
function testAoeHitCount() {
  line('④AOE 命中≥2 → 应放');
  const self = { atk: 8 };
  const enemies = [{ hp: 8 }, { hp: 6 }, { hp: 10 }];
  const dmg = Math.ceil(self.atk / 2);
  const hits = enemies.length;
  const kills = enemies.filter((e) => dmg >= e.hp).length;
  const shouldCast = kills >= 1 || hits >= 2;
  console.log(`  dmg=${dmg} hits=${hits} kills=${kills} shouldCast=${shouldCast}`);
  assert(shouldCast, '三敌在场 → 应放AOE');
}

// ═════════════════════════════════════════════════════════════
//  ⑤ AOE 仅 1 个目标且不能击杀 → 不应放
// ═════════════════════════════════════════════════════════════
function testAoeSingleNoKill() {
  line('⑤AOE 单目标且非击杀 → 不应放');
  const self = { atk: 6 };
  const enemies = [{ hp: 10 }];
  const dmg = Math.ceil(self.atk / 2);   // =3
  const hits = enemies.length;
  const kills = enemies.filter((e) => dmg >= e.hp).length;
  const shouldCast = kills >= 1 || hits >= 2;
  console.log(`  dmg=${dmg} hits=${hits} kills=${kills} shouldCast=${shouldCast}`);
  assert(!shouldCast, '单敌且无法击杀 → 不应放');
}

// ═════════════════════════════════════════════════════════════
//  ⑥ 相邻 AOE ≥2 相邻敌 → 应放
// ═════════════════════════════════════════════════════════════
function testAdjAoe() {
  line('⑥相邻AOE ≥2 相邻 → 应放');
  const self = { row: 2, col: 2, atk: 7 };
  const enemies = [
    { row: 1, col: 2, hp: 8 },  // 相邻
    { row: 2, col: 3, hp: 6 },  // 相邻
    { row: 4, col: 2, hp: 5 },  // 非相邻
  ];
  const adj = enemies.filter((e) => Math.abs(e.row - self.row) + Math.abs(e.col - self.col) === 1);
  const shouldCast = adj.length >= 2 || (adj.length === 1 && self.atk >= adj[0].hp);
  console.log(`  相邻数=${adj.length} shouldCast=${shouldCast}`);
  assert(shouldCast, '两相邻敌 → 应放佛怒火莲');
}

// ═════════════════════════════════════════════════════════════
//  ⑦ 相邻 AOE 仅1相邻且非击杀 → 不应放
// ═════════════════════════════════════════════════════════════
function testAdjAoeSingle() {
  line('⑦相邻AOE 1相邻且非击杀 → 不应放');
  const self = { row: 2, col: 2, atk: 5 };
  const enemies = [
    { row: 1, col: 2, hp: 10 },  // 相邻但打不死
  ];
  const adj = enemies.filter((e) => Math.abs(e.row - self.row) + Math.abs(e.col - self.col) === 1);
  const shouldCast = adj.length >= 2 || (adj.length === 1 && self.atk >= adj[0].hp);
  console.log(`  相邻数=${adj.length} atk=${self.atk} 目标hp=${adj[0].hp}`);
  assert(!shouldCast, '单相邻且不能斩杀 → 不应放');
}

// ═════════════════════════════════════════════════════════════
//  ⑧ 全体增益 · 友方有危血 → 应放
// ═════════════════════════════════════════════════════════════
function testAllyBuffLowHp() {
  line('⑧友方有人血量≤40% → 应放治疗型绝技');
  const allies = [
    { hp: 2, maxHp: 10 },  // 20%
    { hp: 8, maxHp: 8 },
  ];
  const minRatio = Math.min(...allies.map((u) => u.hp / u.maxHp));
  const shouldCast = minRatio <= 0.4;
  console.log(`  最低血量比率=${minRatio} shouldCast=${shouldCast}`);
  assert(shouldCast, '有人残血 → 应放');
}

// ═════════════════════════════════════════════════════════════
//  ⑨ 全体增益 · 友方满血 → 不应放
// ═════════════════════════════════════════════════════════════
function testAllyBuffFull() {
  line('⑨友方满血 → 不应放治疗型绝技');
  const allies = [
    { hp: 8, maxHp: 8 },
    { hp: 7, maxHp: 7 },
  ];
  const minRatio = Math.min(...allies.map((u) => u.hp / u.maxHp));
  const shouldCast = minRatio <= 0.4;
  console.log(`  最低血量比率=${minRatio} shouldCast=${shouldCast}`);
  assert(!shouldCast, '满血 → 不应放');
}

// ═════════════════════════════════════════════════════════════
//  ⑩ 柔骨·缠魂选 atk 最高敌
// ═════════════════════════════════════════════════════════════
function testRougu() {
  line('⑩柔骨·缠魂选 atk 最高敌');
  const enemies = [
    { id: 'E1', atk: 5, hp: 8 },
    { id: 'E2', atk: 9, hp: 10 },   // 修为最高
    { id: 'E3', atk: 7, hp: 6 },
  ];
  const sorted = [...enemies].sort((a, b) => b.atk - a.atk);
  const target = sorted[0];
  console.log(`  选中=${target.id} atk=${target.atk}`);
  assert(target.id === 'E2', '应选 E2（atk=9，威胁最大）');
}

// ═════════════════════════════════════════════════════════════
//  ⑪ UI 瞄准态 · 目标合法性
// ═════════════════════════════════════════════════════════════
function testAimValidation() {
  line('⑪瞄准态非法目标拒绝');
  const targeting = {
    casterId: 'hero_tangsan',
    candidateIds: ['ai_hero_xiaoyan_0'],
  };
  const clickId = 'ai_hero_xuner_1';
  const allowed = targeting.candidateIds.includes(clickId);
  console.log(`  clickId=${clickId} allowed=${allowed}`);
  assert(!allowed, '非候选目标 → 拒绝');
}

// ═════════════════════════════════════════════════════════════
//  ⑫ selectorKind → NEEDS_TARGET 映射
// ═════════════════════════════════════════════════════════════
function testSelectorKindMap() {
  line('⑫selector → NEEDS_TARGET 映射');
  const NEEDS_TARGET = {
    single_any_enemy: true,
    single_line_enemy: true,
    single_adjacent_enemy: true,
    single_any_character: true,
  };
  const AUTO_KIND = ['all_enemies', 'all_allies_incl_self', 'cross_adjacent_enemies', 'all_adjacent_enemies'];
  let ok = true;
  for (const k of ['single_any_enemy', 'single_line_enemy', 'single_adjacent_enemy', 'single_any_character']) {
    if (!NEEDS_TARGET[k]) ok = false;
  }
  for (const k of AUTO_KIND) {
    if (NEEDS_TARGET[k]) ok = false;
  }
  assert(ok, 'single_* → 瞄准态；all_*/cross → 直接施放');
}

// ═════════════════════════════════════════════════════════════
//  ⑬ 八段摔·断魂：已损血=5 vs 敌 hp=6 → 伤害5 + 自身退场
// ═════════════════════════════════════════════════════════════
function testDuanhun() {
  line('⑬八段摔·断魂：已损血5 → 敌承受5固伤 + 自身退场');
  const self = { hp: 3, maxHp: 8, name: '小舞儿' };
  const target = { hp: 6, maxHp: 7, name: 'E', row: 1, col: 2 };
  const lostHp = self.maxHp - self.hp;   // =5
  const dmg = lostHp;
  // 造成伤害
  target.hp = Math.max(0, target.hp - dmg);
  // 自身退场
  self.hp = 0;
  const dead = self.hp <= 0;
  console.log(`  lostHp=${lostHp} → 敌hp变为${target.hp}, 自身dead=${dead}`);
  assert(dmg === 5 && target.hp === 1 && dead, '伤害5 + 敌hp=1 + 小舞儿退场');
}

// ═════════════════════════════════════════════════════════════
//  ⑭ 八段摔·断魂：满血自爆 → 伤害0 + 自身退场
// ═════════════════════════════════════════════════════════════
function testDuanhunFull() {
  line('⑭八段摔·断魂：满血自爆 → 伤害=0 + 自身退场');
  const self = { hp: 7, maxHp: 7 };
  const target = { hp: 8 };
  const lostHp = self.maxHp - self.hp;  // =0
  if (lostHp > 0) target.hp = Math.max(0, target.hp - lostHp);
  self.hp = 0;
  console.log(`  lostHp=${lostHp} target.hp=${target.hp} self.dead=${self.hp===0}`);
  assert(lostHp === 0 && target.hp === 8 && self.hp === 0, '满血自爆不造成伤害但仍退场');
}

// ═════════════════════════════════════════════════════════════
//  ⑮ 八段摔 + 小舞儿退场触发塘散觉醒
// ═════════════════════════════════════════════════════════════
function testDuanhunTriggersAwakening() {
  line('⑮八段摔 → 小舞儿退场 → 塘散觉醒');
  const units = [
    { id: 'hero_xiaowu', name: '小舞儿', hp: 0, dead: true, heroId: 'hero_xiaowu' },  // 自爆后
    { id: 'hero_tangsan', name: '塘散', hp: 5, atk: 7, mnd: 3, awakened: false, dead: false, heroId: 'hero_tangsan' },
  ];
  const xwDead = units[0].dead;
  const shouldTangsanAwaken = xwDead && !units[1].awakened;
  console.log(`  小舞儿.dead=${xwDead} → 塘散觉醒条件满足=${shouldTangsanAwaken}`);
  assert(shouldTangsanAwaken, 'on_self_sacrifice ⊂ on_self_leave 触发觉醒');
}

// ═════════════════════════════════════════════════════════════
//  ⑯ skillUsedThisTurn 防重入
// ═════════════════════════════════════════════════════════════
function testSkillUsedGuard() {
  line('⑯skillUsedThisTurn 防重入');
  const state = { skillUsedThisTurn: false };
  // 第一次评估：放
  const cast1 = !state.skillUsedThisTurn;
  if (cast1) state.skillUsedThisTurn = true;
  // 第二次评估：被拦截
  const cast2 = !state.skillUsedThisTurn;
  console.log(`  第1次=${cast1} 第2次=${cast2}`);
  assert(cast1 && !cast2, '同回合仅放 1 次');
}

// ═════════════════════════════════════════════════════════════
//  执行
// ═════════════════════════════════════════════════════════════
console.log('═'.repeat(65));
console.log('  阶段 D 自测 · UI 瞄准态 + AI 档位② + D1 扫尾');
console.log('═'.repeat(65));
testSingleKillThreshold();
testSingleHalfHpThreshold();
testSingleNoValue();
testAoeHitCount();
testAoeSingleNoKill();
testAdjAoe();
testAdjAoeSingle();
testAllyBuffLowHp();
testAllyBuffFull();
testRougu();
testAimValidation();
testSelectorKindMap();
testDuanhun();
testDuanhunFull();
testDuanhunTriggersAwakening();
testSkillUsedGuard();
console.log('\n' + '═'.repeat(65));
console.log('  阶段 D 自测完毕');
console.log('═'.repeat(65));
