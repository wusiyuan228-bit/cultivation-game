/**
 * 阶段 B 自测：9 条技能
 *   本体被动 3 条：无敌金身 / 青竹蜂云剑·七十二路 / 古族血脉·共鸣
 *   绝技 6 条：修罗弑神击 / 佛怒火莲 / 万剑归宗 / 逆·天地崩 / 金帝天火阵 / 万毒淬体
 *
 * 注：本脚本与 stageA 同样使用"内联 handler"方式验证核心逻辑。
 */

// —— 固定种子骰 ——
let seed = 42;
function fakeRandom() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
Math.random = fakeRandom;
const rollN = (n) => Array.from({ length: Math.max(1, n) }, () => Math.floor(Math.random() * 3));
const sum = (a) => a.reduce((x, y) => x + y, 0);
const COUNTER = { 剑修: '妖修', 妖修: '体修', 体修: '灵修', 灵修: '法修', 法修: '剑修' };

function pad(s, n) { return String(s).padEnd(n); }

// ═════════════════════════════════════════════════════════════
//  ① 无敌金身：伤害封顶 2
// ═════════════════════════════════════════════════════════════
function testWudi() {
  console.log('\n━━━━━━ ①无敌金身 ━━━━━━');
  const att = { name: '敌方', type: '体修', hp: 10, atk: 5, skills: [] };
  const def = { name: '小舞儿', type: '灵修', hp: 10, atk: 2, skills: ['无敌金身'] };
  const aDice = rollN(att.atk); const dDice = rollN(def.atk);
  const aSum = sum(aDice); const dSum = sum(dDice);
  let dmg = aSum - dSum;
  const counter = COUNTER[att.type] === def.type ? 1 : 0;
  dmg += counter;
  // 无敌金身（attackKind=basic）
  let cap = null;
  if (def.skills.includes('无敌金身')) cap = 2;
  if (cap !== null) dmg = Math.min(dmg, cap);
  dmg = Math.max(1, dmg);
  console.log(`${att.name}(atk${att.atk}) → ${def.name}(hp${def.hp},atk${def.atk}) 骰[${aDice.join(',')}]=${aSum} vs [${dDice.join(',')}]=${dSum} 克制+${counter} → 未封顶=${Math.max(1,aSum-dSum+counter)} / 封顶后=${dmg}`);
  console.log(dmg <= 2 ? '  ✅ 无敌金身生效，伤害≤2' : '  ❌ 未封顶');
}

// ═════════════════════════════════════════════════════════════
//  ② 青竹蜂云剑：骰数 = atk + mnd
// ═════════════════════════════════════════════════════════════
function testQingzhu() {
  console.log('\n━━━━━━ ②青竹蜂云剑 ━━━━━━');
  const att = { name: '寒立', type: '剑修', hp: 10, atk: 2, mnd: 3, skills: ['青竹蜂云剑·七十二路'] };
  const def = { name: '敌', type: '妖修', hp: 10, atk: 3, mnd: 1, skills: [] };
  let dA = att.atk;
  if (att.skills.includes('青竹蜂云剑·七十二路')) {
    const over = att.atk + att.mnd;
    if (over > dA) { console.log(`  青竹蜂云剑生效，骰数由 ${dA} 提升至 ${over}`); dA = over; }
  }
  const aDice = rollN(dA); const dDice = rollN(def.atk);
  const aSum = sum(aDice), dSum = sum(dDice);
  const counter = COUNTER[att.type] === def.type ? 1 : 0;
  const dmg = Math.max(1, aSum - dSum + counter);
  console.log(`  ${att.name}(atk${att.atk},mnd${att.mnd}) → ${def.name} 骰数 ${dA}骰 投[${aDice.join(',')}]=${aSum} vs ${def.atk}骰[${dDice.join(',')}]=${dSum} 克制+${counter} → ${dmg}`);
  console.log(dA === 5 ? '  ✅ 骰数=atk+mnd=5' : '  ❌');
}

// ═════════════════════════════════════════════════════════════
//  ③ 古族血脉·共鸣：turn_end 相邻+自身回血 1
// ═════════════════════════════════════════════════════════════
function testGuzu() {
  console.log('\n━━━━━━ ③古族血脉·共鸣 ━━━━━━');
  const self = { name: '薰儿', row: 2, col: 2, hp: 4, maxHp: 6, skills: ['古族血脉·共鸣'] };
  const allies = [
    { name: '友军A', row: 2, col: 3, hp: 3, maxHp: 5 }, // 相邻
    { name: '友军B', row: 1, col: 2, hp: 5, maxHp: 5 }, // 相邻但满血
    { name: '友军C', row: 3, col: 3, hp: 2, maxHp: 5 }, // 斜对角不相邻
  ];
  const heal = [self, ...allies].filter((u) => Math.abs(u.row - self.row) + Math.abs(u.col - self.col) <= 1);
  console.log(`  相邻+自身（曼哈顿≤1）: ${heal.map(x => x.name).join(',')}`);
  const before = heal.map(x => `${x.name}:${x.hp}`).join(' / ');
  for (const u of heal) { if (u.hp < u.maxHp) u.hp = Math.min(u.maxHp, u.hp + 1); }
  const after = heal.map(x => `${x.name}:${x.hp}`).join(' / ');
  console.log(`  治疗前: ${before}`);
  console.log(`  治疗后: ${after}`);
  console.log(self.hp === 5 && allies[0].hp === 4 && allies[1].hp === 5 && allies[2].hp === 2
    ? '  ✅ 古族血脉正确触发（斜对角不生效，满血不回复）' : '  ❌');
}

// ═════════════════════════════════════════════════════════════
//  ④ 修罗弑神击：atk*2 骰
// ═════════════════════════════════════════════════════════════
function testShisha() {
  console.log('\n━━━━━━ ④修罗弑神击 ━━━━━━');
  const att = { name: '修罗·塘散', type: '剑修', atk: 3 };
  const def = { name: '远距离敌', type: '妖修', hp: 15, atk: 3 };
  const dice = att.atk * 2;
  const aDice = rollN(dice); const dDice = rollN(def.atk);
  const aSum = sum(aDice), dSum = sum(dDice);
  const counter = COUNTER[att.type] === def.type ? 1 : 0;
  const dmg = Math.max(1, aSum - dSum + counter);
  console.log(`  骰数 atk*2=${dice} 投[${aDice.join(',')}]=${aSum} vs ${def.atk}骰[${dDice.join(',')}]=${dSum} 克制+${counter} → ${dmg}`);
  console.log(dice === 6 ? '  ✅ 骰数=atk*2=6' : '  ❌');
}

// ═════════════════════════════════════════════════════════════
//  ⑤ 佛怒火莲：相邻 AOE（每段独立）
// ═════════════════════════════════════════════════════════════
function testFonu() {
  console.log('\n━━━━━━ ⑤佛怒火莲 ━━━━━━');
  const self = { name: '萧焱', type: '剑修', atk: 3, row: 2, col: 2 };
  const enemies = [
    { name: '敌A', type: '妖修', hp: 5, atk: 2, row: 1, col: 2 },
    { name: '敌B', type: '体修', hp: 5, atk: 2, row: 2, col: 3 },
    { name: '敌C', type: '灵修', hp: 5, atk: 2, row: 3, col: 2 },
    { name: '斜对角', type: '灵修', hp: 5, atk: 2, row: 1, col: 1 }, // 斜不相邻
  ];
  const targets = enemies.filter((e) => Math.abs(e.row - self.row) + Math.abs(e.col - self.col) === 1);
  console.log(`  相邻敌（四向）: ${targets.map(t => t.name).join(',')}`);
  for (const t of targets) {
    const aDice = rollN(self.atk); const dDice = rollN(t.atk);
    const aSum = sum(aDice), dSum = sum(dDice);
    const counter = COUNTER[self.type] === t.type ? 1 : 0;
    const dmg = Math.max(1, aSum - dSum + counter);
    t.hp -= dmg;
    console.log(`  攻击 ${t.name}: [${aDice.join(',')}]=${aSum} vs [${dDice.join(',')}]=${dSum} 克制+${counter} → ${dmg} (剩余hp=${t.hp})`);
  }
  console.log(targets.length === 3 ? '  ✅ 相邻三敌均被攻击，斜对角未波及' : '  ❌');
}

// ═════════════════════════════════════════════════════════════
//  ⑥ 万剑归宗：同行同列 atk*2
// ═════════════════════════════════════════════════════════════
function testWanjian() {
  console.log('\n━━━━━━ ⑥万剑归宗 ━━━━━━');
  const self = { name: '寒立', type: '剑修', atk: 3, row: 2, col: 2 };
  const enemies = [
    { name: '同列远敌', type: '妖修', hp: 8, atk: 2, row: 0, col: 2 },
    { name: '同行远敌', type: '体修', hp: 8, atk: 2, row: 2, col: 5 },
    { name: '斜对角', type: '灵修', hp: 8, atk: 2, row: 3, col: 4 }, // 既不同行也不同列
  ];
  const candidates = enemies.filter((e) => e.row === self.row || e.col === self.col);
  console.log(`  同行/同列候选: ${candidates.map(t => t.name).join(',')}`);
  const t = candidates[0];
  const dice = self.atk * 2;
  const aDice = rollN(dice); const dDice = rollN(t.atk);
  const aSum = sum(aDice), dSum = sum(dDice);
  const counter = COUNTER[self.type] === t.type ? 1 : 0;
  const dmg = Math.max(1, aSum - dSum + counter);
  t.hp -= dmg;
  console.log(`  攻击 ${t.name}: 骰数 atk*2=${dice} 投[${aDice.join(',')}]=${aSum} vs [${dDice.join(',')}]=${dSum} 克制+${counter} → ${dmg} (剩余hp=${t.hp})`);
  console.log(candidates.length === 2 && dice === 6 ? '  ✅ 同行同列过滤正确，骰数=atk*2' : '  ❌');
}

// ═════════════════════════════════════════════════════════════
//  ⑦ 逆·天地崩：自损 ceil(hp/2)，全场敌人等额伤害
// ═════════════════════════════════════════════════════════════
function testTiandi() {
  console.log('\n━━━━━━ ⑦逆·天地崩 ━━━━━━');
  const self = { name: '旺林', hp: 7, atk: 3 };
  const enemies = [
    { name: '敌A', hp: 5 },
    { name: '敌B', hp: 3 },
    { name: '敌C', hp: 10 },
  ];
  const cost = Math.ceil(self.hp / 2);
  self.hp -= cost;
  console.log(`  自损 ${cost} 点，自身hp: ${self.hp + cost} → ${self.hp}`);
  for (const e of enemies) {
    const before = e.hp;
    e.hp = Math.max(0, e.hp - cost);
    console.log(`  ${e.name} 受到 ${cost} 点固定伤害: ${before} → ${e.hp}${e.hp === 0 ? ' 💀' : ''}`);
  }
  console.log(cost === 4 && self.hp === 3 && enemies[1].hp === 0
    ? '  ✅ ceil(7/2)=4 自损正确，敌B被击杀' : '  ❌');
}

// ═════════════════════════════════════════════════════════════
//  ⑧ 金帝天火阵：modifier-based 群体-3 减伤（本大回合）
// ═════════════════════════════════════════════════════════════
function testTianhuo() {
  console.log('\n━━━━━━ ⑧金帝天火阵 ━━━━━━');
  // 模拟挂载 3 个 damage_reduce modifier
  const friendlies = [
    { name: '薰儿', damageReduce: 0 },
    { name: '萧焱', damageReduce: 0 },
    { name: '塘散', damageReduce: 0 },
  ];
  for (const f of friendlies) f.damageReduce = 3;
  console.log(`  挂载 modifier: ${friendlies.map(f => `${f.name}:-${f.damageReduce}`).join(', ')}`);

  // 模拟友军薰儿受攻击
  const xuner = friendlies[0];
  const rawDmg = 5;
  const finalDmg = Math.max(1, rawDmg - xuner.damageReduce);
  console.log(`  薰儿被攻击，原伤害 ${rawDmg} → 减免 ${xuner.damageReduce} → 最终 ${finalDmg}（Q11②最低1）`);

  // 模拟原伤害<=3 被保底为 1
  const rawLow = 2;
  const finalLow = Math.max(1, rawLow - xuner.damageReduce);
  console.log(`  伤害 ${rawLow} → 减免 3 → 最终 ${finalLow}（Q11②最低=1）`);

  console.log(finalDmg === 2 && finalLow === 1 ? '  ✅ 金帝天火阵减伤正确' : '  ❌');
}

// ═════════════════════════════════════════════════════════════
//  ⑨ 万毒淬体：十字四向 AOE + 命中后 atk-1 永久
// ═════════════════════════════════════════════════════════════
function testWandu() {
  console.log('\n━━━━━━ ⑨万毒淬体 ━━━━━━');
  const self = { name: '塘散', type: '剑修', atk: 3, row: 2, col: 2 };
  const enemies = [
    { name: '上', type: '妖修', hp: 5, atk: 3, row: 1, col: 2 },    // 十字
    { name: '右', type: '体修', hp: 5, atk: 1, row: 2, col: 3 },    // 十字 + atk=1
    { name: '下', type: '灵修', hp: 5, atk: 2, row: 3, col: 2 },    // 十字
    { name: '斜', type: '法修', hp: 5, atk: 2, row: 1, col: 1 },    // 不在十字
  ];
  const targets = enemies.filter(e => Math.abs(e.row - self.row) + Math.abs(e.col - self.col) === 1);
  console.log(`  十字四向候选: ${targets.map(t => t.name).join(',')}`);
  for (const t of targets) {
    const aDice = rollN(self.atk); const dDice = rollN(t.atk);
    const aSum = sum(aDice), dSum = sum(dDice);
    const counter = COUNTER[self.type] === t.type ? 1 : 0;
    const dmg = Math.max(1, aSum - dSum + counter);
    t.hp -= dmg;
    // Q4: 命中后 atk-1 永久；atk=1 的目标仍受伤害但不降 atk（采用之前裁决）
    const oldAtk = t.atk;
    if (t.atk > 1) t.atk = Math.max(1, t.atk - 1);
    const atkNote = oldAtk === 1 ? '（atk=1 未降）' : `(atk ${oldAtk}→${t.atk})`;
    console.log(`  攻击 ${t.name}: [${aDice.join(',')}]=${aSum} vs [${dDice.join(',')}]=${dSum} 克制+${counter} → ${dmg} (hp=${t.hp}) ${atkNote}`);
  }
  const rightEnemy = enemies[1];
  console.log(targets.length === 3 && rightEnemy.atk === 1 ? '  ✅ 万毒淬体十字 AOE 正确，atk=1 未再降' : '  ❌');
}

testWudi();
testQingzhu();
testGuzu();
testShisha();
testFonu();
testWanjian();
testTiandi();
testTianhuo();
testWandu();

console.log('\n✅ 阶段 B 9 条技能全部场景运行完毕');
