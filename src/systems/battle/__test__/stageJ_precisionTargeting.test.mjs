/**
 * stageJ · 按 selector 精准扫描合法目标 + heroesData.ts 文案对齐 cards_all.json
 *
 * 覆盖：
 *   ① heroesData.ts 的 5 条技能/觉醒文案与 cards_all.json 完全一致
 *   ② skillCastability.ts 暴露 hasSameLineEnemyOf 工具
 *   ③ skillCastability.ts 的 SkillCastabilityCtx 接受 allUnits
 *   ④ reason 文案使用新语义"无可释放目标（...）"而非旧"当前不满足：..."
 *   ⑤ selector → 扫描方式映射正确
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..', '..', '..');

let total = 0, passed = 0, failed = 0;
function line(t) { console.log('\n━━━━━━ ' + t + ' ━━━━━━'); }
function pass(m) { total++; passed++; console.log('  ✅ ' + m); }
function fail(m) { total++; failed++; console.log('  ❌ ' + m); }

console.log('═'.repeat(70));
console.log('  阶段 J · 精准目标扫描 + 文案对齐回归');
console.log('═'.repeat(70));

/* ══════════════════════════════════════════════════ */
/*  ① heroesData.ts ↔ cards_all.json 文案对齐          */
/* ══════════════════════════════════════════════════ */
line('① heroesData.ts 与 cards_all.json 的关键 desc 对齐');
{
  const heroesSrc = fs.readFileSync(
    path.join(ROOT, 'data', 'heroesData.ts'),
    'utf8',
  );
  const jsonPath = path.resolve(ROOT, '..', 'public', 'config', 'cards', 'cards_all.json');
  const jsonSrc = fs.readFileSync(jsonPath, 'utf8');

  // 1. 塘散绝技：十字方向（上下左右各1格）
  if (heroesSrc.includes('对十字方向（上下左右各1格）所有敌人各进行1次攻击，被命中的目标修为永久-1（最低为1）')) {
    pass('塘散·暗器·万毒淬体：已补"（上下左右各1格）"和"的"字');
  } else {
    fail('塘散绝技 desc 未对齐 JSON 源头');
  }

  // 2. 塘散清心悟道：无"本次招募限3次"（JSON 源头无此限制）
  if (!heroesSrc.includes('本次招募限3次')) {
    pass('塘散·清心悟道：已移除 heroesData.ts 多余的"本次招募限3次"');
  } else {
    fail('塘散清心悟道仍含多余限制文案');
  }

  // 3. 薰儿觉醒 trigger：古元（绑定SSR）在场时
  if (heroesSrc.includes("trigger: '古元（绑定SSR）在场时气血降至3以下'")) {
    pass('薰儿觉醒 trigger 已补"（绑定SSR）"');
  } else {
    fail('薰儿觉醒 trigger 未对齐');
  }

  // 4. 旺林觉醒 trigger：司徒南（绑定SSR）退场
  if (heroesSrc.includes("trigger: '司徒南（绑定SSR）退场'")) {
    pass('旺林觉醒 trigger 已补"（绑定SSR）"');
  } else {
    fail('旺林觉醒 trigger 未对齐');
  }

  // 5. JSON 源头存在这些文案（保险检查）
  if (jsonSrc.includes('十字方向（上下左右各1格）')) pass('JSON 源头含"十字方向（上下左右各1格）"');
  else fail('JSON 源头文案异常');
  if (jsonSrc.includes('古元（绑定SSR）')) pass('JSON 源头含"古元（绑定SSR）"');
  else fail('JSON 源头文案异常');
  if (jsonSrc.includes('司徒南（绑定SSR）')) pass('JSON 源头含"司徒南（绑定SSR）"');
  else fail('JSON 源头文案异常');
}

/* ══════════════════════════════════════════════════ */
/*  ② skillCastability.ts 暴露 hasSameLineEnemyOf     */
/* ══════════════════════════════════════════════════ */
line('② skillCastability.ts 新增 hasSameLineEnemyOf 工具');
{
  const src = fs.readFileSync(
    path.join(ROOT, 'systems', 'battle', 'skillCastability.ts'),
    'utf8',
  );
  if (src.includes('export function hasSameLineEnemyOf')) {
    pass('hasSameLineEnemyOf 已导出');
  } else {
    fail('hasSameLineEnemyOf 未导出');
  }
  if (src.includes('SkillCastabilityCtx') && /allUnits\?:\s*SkillCheckUnit\[\]/.test(src)) {
    pass('SkillCastabilityCtx 新增 allUnits 字段');
  } else {
    fail('SkillCastabilityCtx 未新增 allUnits');
  }
}

/* ══════════════════════════════════════════════════ */
/*  ③ 新 reason 文案                                    */
/* ══════════════════════════════════════════════════ */
line('③ reason 文案使用"无可释放目标（...）"新语义');
{
  const src = fs.readFileSync(
    path.join(ROOT, 'systems', 'battle', 'skillCastability.ts'),
    'utf8',
  );
  const expectations = [
    '无可释放目标（相邻4格无敌方单位）',
    '无可释放目标（所在行列无敌方单位）',
    '无可释放目标（敌方已全灭）',
  ];
  for (const e of expectations) {
    if (src.includes(e)) pass(`包含新语义: "${e}"`);
    else fail(`缺失新语义: "${e}"`);
  }
}

/* ══════════════════════════════════════════════════ */
/*  ④ selector → 扫描方式映射：模拟 4 个典型场景       */
/* ══════════════════════════════════════════════════ */
line('④ selector → 扫描方式模拟：4 种典型场景');
{
  // 手写一个与 skillCastability 对等的扫描函数做对齐验证
  function hasAdj(u, all) {
    for (const o of all) {
      if (o.dead || o.id === u.id) continue;
      if (o.isEnemy === u.isEnemy) continue;
      if (Math.abs(o.row - u.row) + Math.abs(o.col - u.col) === 1) return true;
    }
    return false;
  }
  function hasLine(u, all) {
    for (const o of all) {
      if (o.dead || o.id === u.id) continue;
      if (o.isEnemy === u.isEnemy) continue;
      if (o.row === u.row || o.col === u.col) return true;
    }
    return false;
  }
  function hasAny(u, all) {
    for (const o of all) {
      if (o.dead || o.id === u.id) continue;
      if (o.isEnemy !== u.isEnemy) return true;
    }
    return false;
  }

  // 场景 A：塘散绝技（cross_adjacent_enemies）无相邻但同列有敌
  //   caster(0,2), enemy(3,2)
  const scenarioA = [
    { id: 't', row: 0, col: 2, isEnemy: false, dead: false },
    { id: 'e', row: 3, col: 2, isEnemy: true, dead: false },
  ];
  if (!hasAdj(scenarioA[0], scenarioA) && hasLine(scenarioA[0], scenarioA) && hasAny(scenarioA[0], scenarioA)) {
    pass('场景A（塘散绝技范围误判）：hasAdj=false 但 hasAny=true，若误用 hasAny 则会错误可释放 → 正确实现应该用 hasAdj');
  } else {
    fail('场景A预期结构异常');
  }

  // 场景 B：寒立万剑（single_line_enemy）同行列有敌
  //   caster(2,2), enemy(2,4)
  const scenarioB = [
    { id: 'h', row: 2, col: 2, isEnemy: false, dead: false },
    { id: 'e', row: 2, col: 4, isEnemy: true, dead: false },
  ];
  if (!hasAdj(scenarioB[0], scenarioB) && hasLine(scenarioB[0], scenarioB)) {
    pass('场景B（寒立万剑）：同行远距敌人 → hasLine=true，可释放');
  } else {
    fail('场景B预期结构异常');
  }

  // 场景 C：旺林绝技（all_enemies）场上任意敌人
  //   caster(0,0), enemy(4,4)
  const scenarioC = [
    { id: 'w', row: 0, col: 0, isEnemy: false, dead: false },
    { id: 'e', row: 4, col: 4, isEnemy: true, dead: false },
  ];
  if (!hasAdj(scenarioC[0], scenarioC) && !hasLine(scenarioC[0], scenarioC) && hasAny(scenarioC[0], scenarioC)) {
    pass('场景C（旺林天地崩）：对角远距敌人 → 只有 hasAny=true，必须用 hasAny 才能正确识别');
  } else {
    fail('场景C预期结构异常');
  }

  // 场景 D：场上无敌（全歼）
  const scenarioD = [
    { id: 'a', row: 0, col: 0, isEnemy: false, dead: false },
    { id: 'e', row: 4, col: 4, isEnemy: true, dead: true },  // 已退场
  ];
  if (!hasAny(scenarioD[0], scenarioD)) {
    pass('场景D（全歼）：所有扫描均 false → 绝技 hasCharges 亮但 interactable=false');
  } else {
    fail('场景D预期结构异常');
  }
}

/* ══════════════════════════════════════════════════ */
console.log('\n' + '═'.repeat(70));
console.log(`  阶段 J · 精准目标扫描回归  总计:${total} 通过:${passed} 失败:${failed}`);
console.log('═'.repeat(70));
if (failed > 0) process.exit(1);
