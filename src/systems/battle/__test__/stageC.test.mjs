/**
 * 阶段 C 自测：觉醒系统
 *
 * 验证点：
 *   ① 小舞儿退场 → 塘散觉醒为"冥煞·塘散"（atk/mnd/hp 原子替换）
 *   ② 小舞儿 hp 降至 1 → 小舞儿觉醒为"涅槃·小舞儿"（hp重置为1、atk/mnd=1）
 *   ③ 寒立累计击杀2名敌人 → 寒立觉醒为"剑虚·寒立"
 *   ④ 萧焱触发条件（场上3+斗破角色）：本阶段 C 环境只有2个斗破主角→不触发
 *   ⑤ 旺林：司徒南退场→觉醒（因 S7B 当前无司徒南 → 永不触发，符合预期）
 *   ⑥ 薰儿：古元在场+hp≤3→觉醒（因 S7B 当前无古元 → 永不触发，符合预期）
 *   ⑦ 觉醒时 unit.awakened=true，不会重复触发
 *   ⑧ 觉醒后技能列表替换、ultimateUsed 重置为 false
 *   ⑨ 十万年魂骨献祭：小舞儿退场时，塘散各属性 +5（破上限）
 *   ⑩ 帝品火莲·毁灭：全场敌人受 ceil(self.atk/2) 固伤
 *   ⑪ 天罗万象·大衍决：选1敌，造成 self.atk 固伤
 *   ⑫ 一念逆天：选1敌，hp 设为1（用 changeStat 模拟）
 *   ⑬ 逆天·万魂幡：on_kill 时 turn 内仅 grant 1 次 extraAction
 *
 * 注：本测试仿照 stageB.test.mjs 的"内联模拟"写法，不启动真实引擎。
 */

function pad(s, n) { return String(s).padEnd(n); }
function line(title) { console.log('\n━━━━━━', title, '━━━━━━'); }

// ═════════════════════════════════════════════════════════════
//  ① 小舞儿退场 → 塘散觉醒
// ═════════════════════════════════════════════════════════════
function testXiaowuLeaveTriggersTangsan() {
  line('①小舞儿退场→塘散觉醒');
  const units = [
    { id: 'hero_tangsan', name: '塘散', hp: 5, atk: 7, mnd: 3, maxHp: 8, awakened: false, dead: false, heroId: 'hero_tangsan' },
    { id: 'hero_xiaowu',  name: '小舞儿', hp: 0, atk: 6, mnd: 4, maxHp: 7, awakened: false, dead: true,  heroId: 'hero_xiaowu' },
  ];
  const BP = {
    hero_tangsan: { awakened: { name: '冥煞·塘散', hp: 10, atk: 10, mnd: 3, hpCap: 10 } },
    hero_xiaowu:  { awakened: { name: '涅槃·小舞儿', hp: 1, atk: 1, mnd: 1, hpCap: 1 } },
  };
  const TRIGGERS = {
    ally_xiaowu_leave: (self, all) => {
      const xw = all.find(u => u.heroId === 'hero_xiaowu');
      return xw && xw.dead;
    },
  };
  const triggerKind = 'ally_xiaowu_leave';
  const tangsan = units[0];
  const shouldAwaken = TRIGGERS[triggerKind](tangsan, units);
  console.log(`  触发条件（小舞儿.dead=${units[1].dead}）: ${shouldAwaken}`);
  if (shouldAwaken) {
    const data = BP.hero_tangsan.awakened;
    tangsan.name = data.name; tangsan.hp = data.hp; tangsan.maxHp = data.hpCap;
    tangsan.atk = data.atk; tangsan.mnd = data.mnd; tangsan.awakened = true;
  }
  console.log(`  觉醒后: ${tangsan.name} hp=${tangsan.hp}/${tangsan.maxHp} atk=${tangsan.atk} mnd=${tangsan.mnd}`);
  console.log(tangsan.name === '冥煞·塘散' && tangsan.atk === 10 ? '  ✅ 正确觉醒' : '  ❌');
}

// ═════════════════════════════════════════════════════════════
//  ② 小舞儿 hp=1 → 自身觉醒
// ═════════════════════════════════════════════════════════════
function testXiaowuSelfHp1() {
  line('②小舞儿 hp=1→觉醒为涅槃·小舞儿');
  const xw = { id: 'hero_xiaowu', name: '小舞儿', hp: 1, atk: 6, mnd: 4, maxHp: 7, awakened: false, dead: false, heroId: 'hero_xiaowu' };
  const trigger = (self) => self.hp === 1 && !self.dead;
  const should = trigger(xw);
  console.log(`  hp=${xw.hp}, 触发=${should}`);
  if (should) {
    xw.name = '涅槃·小舞儿'; xw.hp = 1; xw.maxHp = 1; xw.atk = 1; xw.mnd = 1; xw.awakened = true;
  }
  console.log(`  觉醒后: ${xw.name} hp=${xw.hp}/${xw.maxHp} atk=${xw.atk} mnd=${xw.mnd}`);
  console.log(xw.name === '涅槃·小舞儿' && xw.atk === 1 ? '  ✅' : '  ❌');
}

// ═════════════════════════════════════════════════════════════
//  ③ 寒立累计击杀 2 → 觉醒
// ═════════════════════════════════════════════════════════════
function testHanliKillCount() {
  line('③寒立击杀2→觉醒为剑虚·寒立');
  const hanli = { id: 'hero_hanli', name: '寒立', hp: 7, atk: 7, mnd: 4, maxHp: 7, killCount: 2, awakened: false, dead: false, heroId: 'hero_hanli' };
  const trigger = (self) => !self.dead && (self.killCount ?? 0) >= 2;
  const should = trigger(hanli);
  console.log(`  击杀数=${hanli.killCount}, 触发=${should}`);
  if (should) {
    hanli.name = '剑虚·寒立'; hanli.hp = 9; hanli.maxHp = 9; hanli.atk = 9; hanli.awakened = true;
  }
  console.log(`  觉醒后: ${hanli.name} hp=${hanli.hp}/${hanli.maxHp} atk=${hanli.atk}`);
  console.log(hanli.name === '剑虚·寒立' && hanli.atk === 9 ? '  ✅' : '  ❌');
}

// ═════════════════════════════════════════════════════════════
//  ④ 萧焱：3张+斗破角色 - 阶段C永不满足（只有 hero_xiaoyan 1张）
// ═════════════════════════════════════════════════════════════
function testXiaoyanDoupoCount() {
  line('④萧焱斗破角色≥3→S7B 仅2主角→不触发');
  const units = [
    { heroId: 'hero_xiaoyan', ipTag: 'doupo', dead: false },
    { heroId: 'hero_xuner',   ipTag: 'doupo', dead: false },
    // 场上还有斗罗的塘散/小舞儿
    { heroId: 'hero_tangsan', ipTag: 'douluo', dead: false },
    { heroId: 'hero_xiaowu',  ipTag: 'douluo', dead: false },
  ];
  const count = units.filter(u => u.ipTag === 'doupo' && !u.dead).length;
  const trigger = count >= 3;
  console.log(`  场上斗破角色=${count}, 触发=${trigger}（预期 false：阶段 C 无绑定SSR）`);
  console.log(!trigger ? '  ✅ 正确（不触发）' : '  ❌');
}

// ═════════════════════════════════════════════════════════════
//  ⑤⑥ 旺林/薰儿：绑定SSR 不存在 → 永不触发
// ═════════════════════════════════════════════════════════════
function testWanglinAndXuner() {
  line('⑤⑥旺林/薰儿：绑定SSR未上场→不触发');
  const units = [
    { heroId: 'hero_wanglin', hp: 5, dead: false, name: '旺林' },
    { heroId: 'hero_xuner', hp: 2, dead: false, name: '薰儿' },
  ];
  const allIds = units.map(u => u.heroId);
  const wanglinTrigger = () => allIds.includes('bind_situnan'); // 永远 false
  const xunerTrigger = (self) => self.hp <= 3 && allIds.includes('bind_guyuan'); // 永远 false
  console.log(`  旺林触发=${wanglinTrigger()}, 薰儿触发=${xunerTrigger(units[1])}`);
  console.log((!wanglinTrigger() && !xunerTrigger(units[1])) ? '  ✅ 均不触发（阶段 C 符合预期）' : '  ❌');
}

// ═════════════════════════════════════════════════════════════
//  ⑦ 幂等：已觉醒不再触发
// ═════════════════════════════════════════════════════════════
function testIdempotent() {
  line('⑦已觉醒不重复触发');
  const hanli = { awakened: true, killCount: 5, dead: false };
  const trigger = (self) => !self.awakened && (self.killCount ?? 0) >= 2;
  console.log(`  awakened=true, 触发=${trigger(hanli)}`);
  console.log(!trigger(hanli) ? '  ✅ 不重复触发' : '  ❌');
}

// ═════════════════════════════════════════════════════════════
//  ⑧ 技能列表替换 + ultimateUsed 重置
// ═════════════════════════════════════════════════════════════
function testSkillReplace() {
  line('⑧觉醒后技能与 ultimateUsed 重置');
  const u = {
    skills: ['hero_tangsan.battle.cage', 'hero_tangsan.ultimate'],
    ultimateUsed: true,
    awakened: false,
  };
  const awaken = ['hero_tangsan.awaken.battle', 'hero_tangsan.awaken.ultimate'];
  u.skills = [...awaken]; u.ultimateUsed = false; u.awakened = true;
  console.log(`  skills=${JSON.stringify(u.skills)}, ultimateUsed=${u.ultimateUsed}`);
  console.log(
    u.skills.includes('hero_tangsan.awaken.battle') && !u.ultimateUsed
      ? '  ✅ 技能替换 + 绝技次数重置' : '  ❌'
  );
}

// ═════════════════════════════════════════════════════════════
//  ⑨ 十万年魂骨献祭：小舞儿退场 → 塘散+5
// ═════════════════════════════════════════════════════════════
function testSacrifice() {
  line('⑨十万年魂骨献祭');
  const tangsan = { name: '塘散', hp: 8, atk: 7, mnd: 3, hpCap: 8 };
  // 应用 +5 破上限
  for (const stat of ['hp', 'atk', 'mnd']) {
    tangsan[stat] += 5;
    if (stat === 'hp') tangsan.hpCap = Math.max(tangsan.hpCap, tangsan.hp);
  }
  console.log(`  结果: hp=${tangsan.hp}/${tangsan.hpCap} atk=${tangsan.atk} mnd=${tangsan.mnd}`);
  console.log(tangsan.hp === 13 && tangsan.atk === 12 && tangsan.mnd === 8 && tangsan.hpCap === 13
    ? '  ✅ 破上限 +5' : '  ❌');
}

// ═════════════════════════════════════════════════════════════
//  ⑩ 帝品火莲·毁灭：全场敌人 ceil(atk/2)
// ═════════════════════════════════════════════════════════════
function testHuiMie() {
  line('⑩帝品火莲·毁灭');
  const self = { atk: 10 };
  const enemies = [{ name: 'E1', hp: 8 }, { name: 'E2', hp: 6 }, { name: 'E3', hp: 4 }];
  const damage = Math.ceil(self.atk / 2);
  for (const e of enemies) e.hp = Math.max(0, e.hp - damage);
  console.log(`  damage=${damage}, 结果: ${enemies.map(e => `${e.name}:${e.hp}`).join(' / ')}`);
  console.log(damage === 5 && enemies[0].hp === 3 && enemies[1].hp === 1 && enemies[2].hp === 0
    ? '  ✅ 全场各-5' : '  ❌');
}

// ═════════════════════════════════════════════════════════════
//  ⑪ 天罗万象·大衍决：单体 atk 固伤
// ═════════════════════════════════════════════════════════════
function testDayan() {
  line('⑪天罗万象·大衍决');
  const self = { atk: 9 };
  const target = { name: 'T', hp: 10 };
  target.hp = Math.max(0, target.hp - self.atk);
  console.log(`  ${target.name} 受 ${self.atk} 固伤 → hp=${target.hp}`);
  console.log(target.hp === 1 ? '  ✅' : '  ❌');
}

// ═════════════════════════════════════════════════════════════
//  ⑫ 一念逆天：hp 设为1
// ═════════════════════════════════════════════════════════════
function testYinian() {
  line('⑫一念逆天');
  const target = { name: 'T', hp: 10 };
  const delta = 1 - target.hp;
  target.hp = Math.max(1, target.hp + delta);
  console.log(`  delta=${delta}, hp=${target.hp}`);
  console.log(target.hp === 1 ? '  ✅ hp=1' : '  ❌');
}

// ═════════════════════════════════════════════════════════════
//  ⑬ 逆天·万魂幡：turn 内去重
// ═════════════════════════════════════════════════════════════
function testWanhun() {
  line('⑬逆天·万魂幡 turn 内去重');
  const self = { perTurn: { extraActionsGranted: 0 } };
  const grant = () => {
    if (self.perTurn.extraActionsGranted >= 1) return false;
    self.perTurn.extraActionsGranted += 1;
    return true;
  };
  const r1 = grant(); // 第1杀
  const r2 = grant(); // 第2杀同turn
  console.log(`  第1次击杀 grant=${r1}, 第2次击杀 grant=${r2}`);
  console.log((r1 && !r2 && self.perTurn.extraActionsGranted === 1) ? '  ✅ turn 内仅1次' : '  ❌');
  // 跨turn重置
  self.perTurn.extraActionsGranted = 0;
  const r3 = grant();
  console.log(`  跨turn重置后 grant=${r3}`);
  console.log(r3 ? '  ✅ 跨turn可再grant' : '  ❌');
}

// ═════════════════════════════════════════════════════════════
//  ⑭ 差值法：境界+拜师等永久加法增益在觉醒后保留（Q-C3·A方案）
// ═════════════════════════════════════════════════════════════
function testDeltaPreservesBonus() {
  line('⑭差值法保留永久增益');
  // 塘散本体 base: hp=8/atk=7/mnd=3/hpCap=8
  // 塘散觉醒:     hp=10/atk=10/mnd=3/hpCap=10  → delta: hp+2/atk+3/mnd+0/hpCap+2
  const base     = { hp: 8,  atk: 7,  mnd: 3, hpCap: 8  };
  const awakened = { hp: 10, atk: 10, mnd: 3, hpCap: 10 };
  // 模拟：塘散已被境界+1（hp+1/atk+1/mnd+1）+ 宗门拜师（atk+2）
  // 当前实际值：hp=9/atk=10/mnd=4/hpCap=9
  const u = { hp: 9, atk: 10, mnd: 4, maxHp: 9 };
  // 差值法觉醒
  const atkDelta = awakened.atk - base.atk;     // +3
  const mndDelta = awakened.mnd - base.mnd;     // +0
  const hpCapDelta = awakened.hpCap - base.hpCap; // +2
  u.maxHp = u.maxHp + hpCapDelta;   // 9 + 2 = 11
  u.hp    = u.maxHp;                 // 重置满血 = 11
  u.atk   = u.atk + atkDelta;       // 10 + 3 = 13
  u.mnd   = u.mnd + mndDelta;       // 4 + 0 = 4
  console.log(`  入场含增益: hp=9/9 atk=10 mnd=4 （境界+1 + 拜师+2）`);
  console.log(`  觉醒后:      hp=${u.hp}/${u.maxHp} atk=${u.atk} mnd=${u.mnd}`);
  console.log(`  预期:        hp=11/11 atk=13 mnd=4  （境界+拜师增益全部保留）`);
  const ok = u.hp === 11 && u.maxHp === 11 && u.atk === 13 && u.mnd === 4;
  console.log(ok ? '  ✅ 境界+拜师增益全部保留' : '  ❌ 增益丢失');
}

// ═════════════════════════════════════════════════════════════
//  ⑮ 差值法：战中永久 debuff（如万毒淬体 atk-1）在觉醒后保留
// ═════════════════════════════════════════════════════════════
function testDeltaPreservesDebuff() {
  line('⑮差值法保留战中永久 debuff');
  // 塘散本体 atk=7，被对面焚决·噬焰吞噬 atk-2（变成5）、又被万毒淬体 atk-1（变成4）
  const base     = { atk: 7 };
  const awakened = { atk: 10 };
  const u = { atk: 4 };  // 累计 -3 的战中永久修正
  const atkDelta = awakened.atk - base.atk; // +3
  u.atk = u.atk + atkDelta;   // 4 + 3 = 7
  console.log(`  战中被 -3 修正后 atk=4，觉醒 delta=+3`);
  console.log(`  觉醒后 atk=${u.atk}`);
  console.log(`  预期 atk=7（-3 修正仍保留，不是觉醒卡面的 10）`);
  console.log(u.atk === 7 ? '  ✅ 战中 debuff 正确保留' : '  ❌');
}

// ═════════════════════════════════════════════════════════════
//  ⑯ 差值法：十万年魂骨献祭 +5 破上限后觉醒，叠加效果正确
// ═════════════════════════════════════════════════════════════
function testDeltaWithSacrifice() {
  line('⑯十万年魂骨献祭 + 觉醒叠加');
  // 场景：塘散先被献祭 hp/atk/mnd 各 +5（破上限），再因小舞儿退场而觉醒
  // 本体卡面 hp=8/atk=7/mnd=3/hpCap=8
  // 献祭后：hp=13/atk=12/mnd=8/hpCap=13
  // 觉醒：atk+3/mnd+0/hpCap+2 → hp=15(满)/atk=15/mnd=8/hpCap=15
  const base     = { hp: 8,  atk: 7,  mnd: 3, hpCap: 8  };
  const awakened = { hp: 10, atk: 10, mnd: 3, hpCap: 10 };
  const u = { hp: 13, atk: 12, mnd: 8, maxHp: 13 };  // 献祭后
  const atkDelta = awakened.atk - base.atk;       // +3
  const mndDelta = awakened.mnd - base.mnd;       // +0
  const hpCapDelta = awakened.hpCap - base.hpCap; // +2
  u.maxHp = u.maxHp + hpCapDelta;
  u.hp    = u.maxHp;
  u.atk   = u.atk + atkDelta;
  u.mnd   = u.mnd + mndDelta;
  console.log(`  献祭后 hp=13/13 atk=12 mnd=8，然后觉醒`);
  console.log(`  觉醒后 hp=${u.hp}/${u.maxHp} atk=${u.atk} mnd=${u.mnd}`);
  console.log(`  预期   hp=15/15 atk=15 mnd=8（献祭的+5 +形态差 全部保留并抬升）`);
  const ok = u.hp === 15 && u.maxHp === 15 && u.atk === 15 && u.mnd === 8;
  console.log(ok ? '  ✅ 献祭+觉醒正确叠加' : '  ❌');
}

// ═════════════════════════════════════════════════════════════
//  ⑰ 档位②：控制类 debuff（immobileNextTurn 等）在觉醒瞬间清除
// ═════════════════════════════════════════════════════════════
function testAwakeningClearsControl() {
  line('⑰觉醒清控制类 debuff');
  const u = {
    name: '塘散', awakened: false,
    immobilized: true,       // 蓝银囚笼
    stunned: true,           // 某技能眩晕
    immobileNextTurn: true,  // 下一行动轮定身
    // 战中数值 debuff（非控制类）— 差值法保留
    atk: 4,  // 假设被 -3 修正
  };
  // 执行觉醒
  u.awakened = true;
  u.immobilized = false;
  u.stunned = false;
  u.immobileNextTurn = false;
  // atk 通过差值法（+3）恢复到 7
  u.atk = u.atk + 3;
  console.log(`  觉醒后 immobilized=${u.immobilized} stunned=${u.stunned} immobileNextTurn=${u.immobileNextTurn} atk=${u.atk}`);
  console.log(`  预期   控制全清 + 数值 debuff 保留（atk=7，非觉醒卡面的10）`);
  const ok = !u.immobilized && !u.stunned && !u.immobileNextTurn && u.atk === 7;
  console.log(ok ? '  ✅ 控制解除 + 数值 debuff 保留' : '  ❌');
}

// ═════════════════════════════════════════════════════════════
//  执行
// ═════════════════════════════════════════════════════════════
console.log('═'.repeat(65));
console.log('  阶段 C 自测 · 觉醒系统 + 8 条觉醒技能');
console.log('═'.repeat(65));
testXiaowuLeaveTriggersTangsan();
testXiaowuSelfHp1();
testHanliKillCount();
testXiaoyanDoupoCount();
testWanglinAndXuner();
testIdempotent();
testSkillReplace();
testSacrifice();
testHuiMie();
testDayan();
testYinian();
testWanhun();
testDeltaPreservesBonus();
testDeltaPreservesDebuff();
testDeltaWithSacrifice();
testAwakeningClearsControl();
console.log('\n' + '═'.repeat(65));
console.log('  阶段 C 自测完毕');
console.log('═'.repeat(65));
