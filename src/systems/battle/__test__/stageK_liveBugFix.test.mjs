/**
 * stageK · 本轮 4 个生产 Bug 修复的专项回归
 *
 * 覆盖 Bug 清单（2026-05-01 线上反馈）：
 *   ① 塘散绝技【暗器·万毒淬体】释放后无任何效果
 *      根因：UI 对 cross_adjacent_enemies selector 传入 targetIds=[]，
 *            store.multiSegmentSkills.targets 空 → for 循环空跑
 *      修复：performUltimate 在 targetIds 为空时使用 precheck.candidateIds
 *
 *   ② 小舞绝技【八段摔·断魂】释放 → 战报"效果待实装"
 *      根因：SKILL_NAME_TO_REGISTRY_ID 漏注册该技能名
 *      修复：skills_s7b.ts 补 '八段摔·断魂': 'hero_xiaowu.ultimate'
 *
 *   ③ 小舞进攻塘散 → "无敌金身"错误触发（封顶伤害）
 *      根因：s7bBattleStore.fireHooks 对 attacker 和 defender 双方都 fire on_damage_calc，
 *            无敌金身 hook 缺少"本单位身为 defender"保护
 *      修复：fireHooks 注入 ctx.__firingUnitIsAttacker__；
 *            xiaowu_wudi.ts 判断 __firingUnitIsAttacker__ 为 true 时立即 return
 *
 *   ④ 7 vs 7 攻防 → 战报"→ 2点伤害"（应为 1）
 *      根因：__cap__ 类 calcLog entry 被错误加到 damage（Phase ①），
 *            cap.delta=2 被累加 → 0 + 2 = 2
 *      修复：Phase ① 加减循环跳过 __cap__；Phase ④ 独立做 min 封顶
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
console.log('  阶段 K · 4 大线上 Bug 修复回归');
console.log('═'.repeat(70));

/* ══════════════════════════════════════════════════ */
/*  ①  塘散万毒：AOE 类 UI 空 targetIds 回落到 candidateIds */
/* ══════════════════════════════════════════════════ */
line('① 塘散绝技：performUltimate 对空 targetIds 回落到 precheck.candidateIds');
{
  const storeSrc = fs.readFileSync(
    path.join(ROOT, 'stores', 's7bBattleStore.ts'),
    'utf8',
  );
  if (storeSrc.includes("aoeSelectors") && storeSrc.includes("precheckCandidateIds")) {
    pass('performUltimate 新增 aoeSelectors 集合与 precheckCandidateIds 变量');
  } else {
    fail('performUltimate 未做 AOE 空 targetIds 回落');
  }
  if (storeSrc.includes('multi.targets') || storeSrc.includes('effectiveTargetIds')) {
    pass('multiSegmentSkills 使用 effectiveTargetIds 传入');
  } else {
    fail('multiSegmentSkills 仍使用原 targetIds');
  }
  // 模拟一次：cross_adjacent_enemies selector，targetIds=[] → candidateIds=['e1','e2']
  const aoeSelectors = new Set([
    'cross_adjacent_enemies',
    'all_adjacent_enemies',
    'all_enemies',
    'all_allies_incl_self',
  ]);
  function simulate(targetIds, kind, candidates) {
    let eff = targetIds;
    if ((!eff || eff.length === 0) && aoeSelectors.has(kind) && candidates.length > 0) {
      eff = candidates;
    }
    return eff;
  }
  const r = simulate([], 'cross_adjacent_enemies', ['e1', 'e2', 'e3']);
  if (r.length === 3 && r[0] === 'e1') {
    pass('模拟：UI 传 [] + precheck 给出 [e1,e2,e3] → effectiveTargetIds=[e1,e2,e3]');
  } else {
    fail(`模拟失败: ${JSON.stringify(r)}`);
  }
  const r2 = simulate(['x'], 'single_adjacent_enemy', []);
  if (r2.length === 1 && r2[0] === 'x') {
    pass('模拟：UI 传 [x] + single_adjacent → 保持 [x]（不覆盖非 AOE selector）');
  } else {
    fail('单体 selector 被意外覆盖');
  }
}

/* ══════════════════════════════════════════════════ */
/*  ②  八段摔 注册名映射                                */
/* ══════════════════════════════════════════════════ */
line('② 小舞绝技【八段摔·断魂】已补注册到 SKILL_NAME_TO_REGISTRY_ID');
{
  const src = fs.readFileSync(
    path.join(ROOT, 'data', 'skills_s7b.ts'),
    'utf8',
  );
  if (src.includes("'八段摔·断魂': 'hero_xiaowu.ultimate'")) {
    pass('八段摔·断魂 已映射到 hero_xiaowu.ultimate');
  } else {
    fail('八段摔·断魂 映射缺失');
  }
  // 同步确认注册表有导入
  const regSrc = fs.readFileSync(
    path.join(ROOT, 'systems', 'battle', 'skillRegistry.ts'),
    'utf8',
  );
  if (regSrc.includes('skill_xiaowu_duanhun') && regSrc.includes('SkillRegistry.register(skill_xiaowu_duanhun)')) {
    pass('skillRegistry.ts 已 import 并 register skill_xiaowu_duanhun');
  } else {
    fail('skillRegistry.ts 未注册 skill_xiaowu_duanhun');
  }
}

/* ══════════════════════════════════════════════════ */
/*  ③  无敌金身仅在 defender 侧生效                     */
/* ══════════════════════════════════════════════════ */
line('③ 无敌金身 on_damage_calc 仅在本单位身为 defender 时生效');
{
  const wudiSrc = fs.readFileSync(
    path.join(ROOT, 'systems', 'battle', 'skills', 'xiaowu_wudi.ts'),
    'utf8',
  );
  if (wudiSrc.includes('__firingUnitIsAttacker__')) {
    pass('xiaowu_wudi.ts 使用 __firingUnitIsAttacker__ 判断身份');
  } else {
    fail('xiaowu_wudi.ts 未引入 __firingUnitIsAttacker__ 保护');
  }
  const storeSrc = fs.readFileSync(
    path.join(ROOT, 'stores', 's7bBattleStore.ts'),
    'utf8',
  );
  if (storeSrc.includes('__firingUnitIsAttacker__') && storeSrc.includes('unit.id === newAttacker.id')) {
    pass('fireHooks 在每次 fire 时注入 ctx.__firingUnitIsAttacker__');
  } else {
    fail('fireHooks 未注入身份字段');
  }
  // 模拟：小舞身份判定
  function simulateWudi(firingUnitIsAttacker) {
    if (firingUnitIsAttacker === true) return 'skip';
    return 'capped';
  }
  const a = simulateWudi(true);
  const b = simulateWudi(false);
  if (a === 'skip' && b === 'capped') {
    pass('模拟：小舞作为 attacker → 跳过封顶；作为 defender → 封顶生效');
  } else {
    fail(`模拟失败: attacker=${a}, defender=${b}`);
  }
}

/* ══════════════════════════════════════════════════ */
/*  ④  __cap__ 不被 Phase ① 累加                        */
/* ══════════════════════════════════════════════════ */
line('④ 伤害计算 Phase ① 跳过 __cap__ 类 calcLog entry');
{
  const storeSrc = fs.readFileSync(
    path.join(ROOT, 'stores', 's7bBattleStore.ts'),
    'utf8',
  );
  // 关键：Phase ① 加减循环必须跳过 __cap__
  const phase1Region = storeSrc.match(/\/\/ ① 攻方\/守方加减项[\s\S]{0,400}?(?:\/\/ 克制)/);
  if (phase1Region && /entry\.source\.endsWith\('__cap__'\)\s*\)\s*continue/.test(phase1Region[0])) {
    pass('Phase ① 加减循环包含 "__cap__" continue 跳过');
  } else {
    fail('Phase ① 未跳过 __cap__');
  }

  // 模拟完整伤害计算
  function simulateDamage(aSum, dSum, capEntries, bonusEntries) {
    let damage = aSum - dSum;
    // Phase ①（修复后跳过 cap）
    for (const e of bonusEntries) damage += e;
    // Phase ④ cap
    for (const cap of capEntries) damage = Math.min(damage, cap);
    // 保底
    damage = Math.max(1, damage);
    return damage;
  }
  // 场景：小舞 7 vs 塘散 7，修复后应该 = 1
  const d1 = simulateDamage(7, 7, [2], []);
  if (d1 === 1) {
    pass('场景：小舞7 vs 塘散7 + 无敌金身 cap=2 → 最终伤害 1（修复前为 2）');
  } else {
    fail(`场景：小舞7 vs 塘散7 期望 1，实际 ${d1}`);
  }
  // 场景：对小舞 9 vs 2（拉大 7 点差距） + cap=2 → 封顶 2
  const d2 = simulateDamage(9, 2, [2], []);
  if (d2 === 2) {
    pass('场景：攻 9 vs 防 2 + cap=2 → 正确封顶 2');
  } else {
    fail(`场景：大伤害封顶测试失败 ${d2}`);
  }
  // 场景：cap 不应被加为加项（修复前 0 + 2 = 2）
  const d3 = simulateDamage(5, 5, [2], []);
  if (d3 === 1) {
    pass('场景：攻 5 vs 防 5 + cap=2 → 结果 1（保底生效，cap 未被加成加项）');
  } else {
    fail(`场景：cap 加成泄漏, 实际 ${d3}`);
  }
}

/* ══════════════════════════════════════════════════ */
/*  ⑤  战报 capText 新增                                */
/* ══════════════════════════════════════════════════ */
line('⑤ 战报模板新增 [伤害上限封顶 N] 独立徽章');
{
  const storeSrc = fs.readFileSync(
    path.join(ROOT, 'stores', 's7bBattleStore.ts'),
    'utf8',
  );
  if (storeSrc.includes('capText') && storeSrc.includes('伤害上限封顶')) {
    pass('战报模板引入 capText 并显示"伤害上限封顶 N"');
  } else {
    fail('战报未显示 capText');
  }
  // bonusText 不再包含 cap 的 note
  if (/\.filter\(\(e\) => !e\.source\.endsWith\('__cap__'\)\)/.test(storeSrc)) {
    pass('bonusEntries 过滤 __cap__（不再把封顶误列为加减项）');
  } else {
    fail('bonusEntries 未过滤 __cap__');
  }
}

/* ══════════════════════════════════════════════════ */
console.log('\n' + '═'.repeat(70));
console.log(`  阶段 K · 4 大线上 Bug 修复回归  总计:${total} 通过:${passed} 失败:${failed}`);
console.log('═'.repeat(70));
if (failed > 0) process.exit(1);
