/**
 * 阶段 A 自测：6 条 P0 技能 + 7-phase hook 流程
 * 用法：node --experimental-vm-modules src/systems/battle/__test__/stageA.test.mjs
 *
 * 注：该测试脚本 hard-code 所需 hook 行为，纯验证 SkillRegistry + resolveAttack 的结算正确性
 * （实际 TS 源由 vite 编译，此处直接复现核心逻辑来做快速手测）
 */

// —— 3 面骰 fix seed，便于复现 ——
let seed = 12345;
function fakeRandom() {
  seed = (seed * 9301 + 49297) % 233280;
  return seed / 233280;
}
Math.random = fakeRandom;

// —— 把 6 条技能的关键逻辑直接内联（跟 skills/*.ts 一致）——
const COUNTER = { 剑修: '妖修', 妖修: '体修', 体修: '灵修', 灵修: '法修', 法修: '剑修' };

function runAttack(attacker, defender, scenarioName) {
  // Phase 1/2：on_before_roll
  let dA = attacker.atk;
  let dD = defender.atk;
  const log = [];

  // 修罗瞳·支配（塘散觉醒）：常驻攻/防 +2
  if (attacker.skills.includes('修罗瞳·支配')) {
    dA += 2;
    log.push('修罗瞳·支配：进攻骰+2');
  }
  if (defender.skills.includes('修罗瞳·支配')) {
    dD += 2;
    log.push('修罗瞳·支配：防守骰+2');
  }

  // Phase 3：投骰
  const rollN = (n) => Array.from({ length: Math.max(1, n) }, () => Math.floor(Math.random() * 3));
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const aDice = rollN(dA);
  const dDice = rollN(dD);
  const aSum = sum(aDice);
  const dSum = sum(dDice);

  // Phase 5：on_damage_calc
  const calcLog = [];
  // 昊天锤·碎：+1
  if (attacker.skills.includes('昊天锤·碎')) {
    calcLog.push({ source: '昊天锤·碎', delta: 1 });
  }
  // 萧族斗气·焚：对妖修 +3
  if (attacker.skills.includes('萧族斗气·焚')) {
    if (defender.type === '妖修') {
      calcLog.push({ source: '萧族斗气·焚', delta: 3 });
    } else {
      log.push('萧族斗气·焚：目标非妖修，未生效');
    }
  }

  let damage = aSum - dSum;
  for (const e of calcLog) damage += e.delta;
  // 克制
  const counter = COUNTER[attacker.type] === defender.type ? 1 : 0;
  damage += counter;

  // 噬金虫群：×2（阶段③）
  if (attacker.skills.includes('噬金虫群')) {
    damage = damage * 2;
    log.push('噬金虫群：伤害×2');
  }

  damage = Math.max(1, damage);

  // 落实
  const newDefHp = Math.max(0, defender.hp - damage);

  // Phase 6：on_after_hit
  if (attacker.skills.includes('焚决·噬焰')) {
    if (defender.atk <= 1) {
      log.push('焚决·噬焰：目标atk=1，未生效');
    } else if (newDefHp <= 0) {
      log.push('焚决·噬焰：目标即将退场，未生效');
    } else {
      defender.atk = Math.max(1, defender.atk - 1);
      attacker.atk = attacker.atk + 1;
      log.push(`焚决·噬焰：吞噬生效（${defender.name}.atk-1, ${attacker.name}.atk+1）`);
    }
  }
  if (attacker.skills.includes('邪灵诀·夺命')) {
    if (damage <= 0) {
      log.push('邪灵诀·夺命：无有效伤害，未生效');
    } else {
      const oldHp = attacker.hp;
      attacker.hp = attacker.hp + 1;
      attacker.maxHp = Math.max(attacker.maxHp, attacker.hp);
      log.push(`邪灵诀·夺命：吸血生效（${attacker.name}.hp ${oldHp}→${attacker.hp}）`);
    }
  }

  defender.hp = newDefHp;

  console.log(`\n━━━━━━ 场景: ${scenarioName} ━━━━━━`);
  console.log(`${attacker.name}(atk${attacker.atk - (attacker.skills.includes('焚决·噬焰') && defender.atk !== attacker.atk - 1 ? 1 : 0)}) → ${defender.name}(hp${defender.hp + damage},atk${defender.atk})`);
  console.log(`  骰数 ${dA}骰 vs ${dD}骰 → [${aDice.join(',')}]=${aSum} vs [${dDice.join(',')}]=${dSum}`);
  if (calcLog.length) console.log(`  修正: ${calcLog.map(e => e.source + '+' + e.delta).join(', ')}`);
  if (counter) console.log(`  克制+1`);
  console.log(`  最终伤害: ${damage}`);
  log.forEach(l => console.log(`  · ${l}`));
  console.log(`  ${defender.name} 剩余: hp=${defender.hp}, atk=${defender.atk}`);
  console.log(`  ${attacker.name} 剩余: hp=${attacker.hp}, atk=${attacker.atk}`);
}

// ════════════════════════════════════════
// 场景 1: 昊天锤·碎 —— damage_calc +1 正常生效
// ════════════════════════════════════════
runAttack(
  { name: '塘昊', type: '剑修', hp: 8, atk: 3, maxHp: 8, skills: ['昊天锤·碎'] },
  { name: '敌方体修', type: '体修', hp: 8, atk: 3, maxHp: 8, skills: [] },
  '①昊天锤·碎（+1 纯数值）'
);

// ════════════════════════════════════════
// 场景 2: 修罗瞳·支配 —— 觉醒塘散攻/防双向 +2 骰
// ════════════════════════════════════════
runAttack(
  { name: '修罗·塘散', type: '剑修', hp: 9, atk: 2, maxHp: 9, skills: ['修罗瞳·支配'] },
  { name: '敌方法修', type: '法修', hp: 7, atk: 3, maxHp: 7, skills: [] },
  '②修罗瞳·支配（攻骰 2→4）'
);
// 反向：塘散防御时
runAttack(
  { name: '敌方法修', type: '法修', hp: 7, atk: 4, maxHp: 7, skills: [] },
  { name: '修罗·塘散', type: '剑修', hp: 9, atk: 2, maxHp: 9, skills: ['修罗瞳·支配'] },
  '②修罗瞳·支配（防骰 2→4）'
);

// ════════════════════════════════════════
// 场景 3: 萧族斗气·焚 —— 条件 +3（仅妖修）
// ════════════════════════════════════════
runAttack(
  { name: '萧玄', type: '剑修', hp: 8, atk: 3, maxHp: 8, skills: ['萧族斗气·焚'] },
  { name: '妖修敌', type: '妖修', hp: 8, atk: 3, maxHp: 8, skills: [] },
  '③萧族斗气·焚（对妖修生效 +3）'
);
runAttack(
  { name: '萧玄', type: '剑修', hp: 8, atk: 3, maxHp: 8, skills: ['萧族斗气·焚'] },
  { name: '体修敌', type: '体修', hp: 8, atk: 3, maxHp: 8, skills: [] },
  '③萧族斗气·焚（对体修无效）'
);

// ════════════════════════════════════════
// 场景 4: 焚决·噬焰 —— 吞噬
// ════════════════════════════════════════
runAttack(
  { name: '萧焱', type: '剑修', hp: 9, atk: 3, maxHp: 9, skills: ['焚决·噬焰'] },
  { name: '敌方灵修', type: '灵修', hp: 10, atk: 3, maxHp: 10, skills: [] },
  '④焚决·噬焰（正常吞噬）'
);
// Q9：目标 atk=1 时不生效
runAttack(
  { name: '萧焱', type: '剑修', hp: 9, atk: 3, maxHp: 9, skills: ['焚决·噬焰'] },
  { name: '弱敌', type: '灵修', hp: 10, atk: 1, maxHp: 10, skills: [] },
  '④焚决·噬焰（目标atk=1，未生效）'
);

// ════════════════════════════════════════
// 场景 5: 邪灵诀·夺命 —— 吸血
// ════════════════════════════════════════
runAttack(
  { name: '旺林', type: '剑修', hp: 5, atk: 3, maxHp: 5, skills: ['邪灵诀·夺命'] },
  { name: '敌人', type: '妖修', hp: 8, atk: 2, maxHp: 8, skills: [] },
  '⑤邪灵诀·夺命（破上限吸血：hp 5→6 > maxHp 5）'
);

// ════════════════════════════════════════
// 场景 6: 噬金虫群 —— 伤害×2
// ════════════════════════════════════════
runAttack(
  { name: '元婴·寒立', type: '剑修', hp: 10, atk: 4, maxHp: 10, skills: ['噬金虫群'] },
  { name: '敌方法修', type: '法修', hp: 15, atk: 3, maxHp: 15, skills: [] },
  '⑥噬金虫群（×2 倍率）'
);

// ════════════════════════════════════════
// 场景 7：组合（修罗瞳+昊天锤同台）
// 验证 hook 可以多技能叠加
// ════════════════════════════════════════
runAttack(
  { name: '双技能测试', type: '剑修', hp: 10, atk: 3, maxHp: 10, skills: ['修罗瞳·支配', '昊天锤·碎'] },
  { name: '敌', type: '妖修', hp: 12, atk: 3, maxHp: 12, skills: [] },
  '⑦组合：修罗瞳(+2骰) + 昊天锤(+1) + 克制(+1)'
);

console.log('\n✅ 全部场景运行完毕，请核对每项输出。');
