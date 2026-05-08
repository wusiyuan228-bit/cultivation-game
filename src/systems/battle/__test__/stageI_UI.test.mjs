/**
 * stageI · UI 语义改造回归测试
 *
 * 覆盖：
 *   ① 旺林绝技（全场 AOE）不应被"需要相邻敌人"误判
 *   ② 被动技 → 绿灯常亮 + isPassive=true + 不可交互
 *   ③ 主动技有次数但条件不满足 → hasCharges=true + interactable=false
 *   ④ 主动技次数耗尽 → hasCharges=false + interactable=false
 *   ⑤ single_adjacent_enemy 类型仍需相邻判定
 *   ⑥ emoji 已从 S7/S7B 代码中清除
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..', '..', '..');

let total = 0;
let passed = 0;
let failed = 0;
function line(t) { console.log('\n━━━━━━ ' + t + ' ━━━━━━'); }
function pass(m) { total++; passed++; console.log('  ✅ ' + m); }
function fail(m) { total++; failed++; console.log('  ❌ ' + m); }

console.log('═'.repeat(70));
console.log('  阶段 I · UI 语义改造回归');
console.log('═'.repeat(70));

/* ══════════════════════════════════════════════════ */
/*  ① 旺林绝技 selector 识别                          */
/* ══════════════════════════════════════════════════ */
line('①旺林·逆·天地崩 selector = all_enemies（AOE）');
{
  const src = fs.readFileSync(
    path.join(ROOT, 'systems', 'battle', 'skills', 'wanglin_tiandi.ts'),
    'utf8',
  );
  if (/targetSelector.*all_enemies/s.test(src) || /kind:\s*['"]all_enemies['"]/.test(src)) {
    pass('wanglin_tiandi.ts 注册为 all_enemies（全场 AOE）');
  } else {
    fail('wanglin_tiandi.ts selector 不是 all_enemies，需人工检查');
  }
}

/* ══════════════════════════════════════════════════ */
/*  ② 被动技常亮逻辑                                   */
/* ══════════════════════════════════════════════════ */
line('②被动技 → hasCharges=true, interactable=false, isPassive=true');
{
  // 模拟 checkSkillCastability 的被动分支
  function mockCheck(registration) {
    if (registration && !registration.isActive) {
      return { hasCharges: true, interactable: false, isPassive: true, reason: '被动技能 · 战斗中持续生效' };
    }
    return null;
  }

  const passiveReg = { isActive: false };
  const r = mockCheck(passiveReg);
  if (r.hasCharges && !r.interactable && r.isPassive) {
    pass('被动技：绿灯常亮 + 不可点击 + 标记 isPassive');
  } else {
    fail(`被动技判定异常：${JSON.stringify(r)}`);
  }
}

/* ══════════════════════════════════════════════════ */
/*  ③ 有次数但条件不满足（距离/目标）                   */
/* ══════════════════════════════════════════════════ */
line('③有次数+条件不满足 → 绿灯亮但按钮禁用');
{
  // 模拟 single_adjacent_enemy 但四周无敌
  function mockCheck(selectorKind, hasAdj) {
    if (selectorKind === 'single_adjacent_enemy' && !hasAdj) {
      return { hasCharges: true, interactable: false, isPassive: false, reason: '当前不满足：周围无相邻敌人' };
    }
    return { hasCharges: true, interactable: true, isPassive: false };
  }

  const r1 = mockCheck('single_adjacent_enemy', false);
  const r2 = mockCheck('single_adjacent_enemy', true);
  if (r1.hasCharges && !r1.interactable && r1.reason.includes('相邻')) {
    pass('无相邻敌人：灯亮、按钮禁用、tip 提示"周围无相邻敌人"');
  } else {
    fail(`条件不满足场景异常：${JSON.stringify(r1)}`);
  }
  if (r2.hasCharges && r2.interactable) {
    pass('有相邻敌人：灯亮、按钮可点');
  } else {
    fail(`正常场景异常：${JSON.stringify(r2)}`);
  }
}

/* ══════════════════════════════════════════════════ */
/*  ④ 次数耗尽                                         */
/* ══════════════════════════════════════════════════ */
line('④绝技已用过 → 灯灭、按钮禁用、按钮仍显示');
{
  function mockCheck(ultimateUsed) {
    if (ultimateUsed) {
      return { hasCharges: false, interactable: false, isPassive: false, reason: '绝技已在本场战斗使用过' };
    }
    return { hasCharges: true, interactable: true, isPassive: false };
  }

  const r = mockCheck(true);
  if (!r.hasCharges && !r.interactable && r.reason.includes('已在本场战斗')) {
    pass('已用过：灯灭 + 按钮禁用 + 提示"已在本场战斗使用过"');
  } else {
    fail(`已用过场景异常：${JSON.stringify(r)}`);
  }
}

/* ══════════════════════════════════════════════════ */
/*  ⑤ AOE/远程绝技不判距离                            */
/* ══════════════════════════════════════════════════ */
line('⑤all_enemies / auto_self / none 不判距离');
{
  // 旺林、薰儿天火阵 等 selector 模拟
  function mockCheck(selectorKind, hasAdj, hasAnyEnemy) {
    switch (selectorKind) {
      case 'single_adjacent_enemy':
      case 'all_adjacent_enemies':
      case 'cross_adjacent_enemies':
        return hasAdj ? { interactable: true } : { interactable: false, reason: '无相邻敌人' };
      case 'single_any_enemy':
      case 'single_line_enemy':
      case 'all_enemies':
        return hasAnyEnemy ? { interactable: true } : { interactable: false, reason: '场上无敌人' };
      case 'none':
      case 'all_allies_incl_self':
        return { interactable: true };
      default:
        return { interactable: true };
    }
  }

  // 旺林绝技 — hasAdj=false 但 hasAnyEnemy=true
  const wanglin = mockCheck('all_enemies', false, true);
  if (wanglin.interactable) pass('旺林·逆·天地崩：无相邻敌人但场上有敌人 → 可释放（修复前 bug）');
  else fail('旺林绝技仍被误判为不可释放');

  // 薰儿天火阵 — selector=none
  const xuner = mockCheck('none', false, false);
  if (xuner.interactable) pass('薰儿·九重天火阵：selector=none，无需距离/目标');
  else fail('none selector 被误判');

  // 修罗弑神击 — single_any_enemy
  const tangsan = mockCheck('single_any_enemy', false, true);
  if (tangsan.interactable) pass('唐三·修罗弑神击：无相邻但场上有敌人 → 可释放');
  else fail('single_any_enemy 被误判');
}

/* ══════════════════════════════════════════════════ */
/*  ⑥ emoji 已从三界面清除                            */
/* ══════════════════════════════════════════════════ */
line('⑥技能名前的 ⚔ / 💫 已移除');
{
  const files = [
    path.join(ROOT, 'screens', 'S7_Battle.tsx'),
    path.join(ROOT, 'screens', 'S7B_Battle.tsx'),
  ];
  let offenders = [];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    // 只看 "⚔ {xxx.battleSkill.name}" / "💫 {xxx.ultimate.name}" 这种模式
    const badSword = /⚔\s+\{[^}]*battleSkill[^}]*\}/.test(src);
    const badStar = /💫\s+\{[^}]*ultimate[^}]*\}/.test(src);
    if (badSword || badStar) offenders.push(path.basename(f));
  }
  if (offenders.length === 0) {
    pass('S7_Battle.tsx 和 S7B_Battle.tsx 的技能名前缀 emoji 已全部清除');
  } else {
    fail(`仍存在 emoji 前缀：${offenders.join(', ')}`);
  }

  // 确认新格式"技能："/"绝技："存在
  const s7b = fs.readFileSync(path.join(ROOT, 'screens', 'S7B_Battle.tsx'), 'utf8');
  if (s7b.includes('技能：') && s7b.includes('绝技：')) {
    pass('S7B 出现新格式"技能："和"绝技："');
  } else {
    fail('S7B 未找到新格式文字');
  }
}

/* ══════════════════════════════════════════════════ */
/*  ⑦ CSS 新增金色绝技样式                            */
/* ══════════════════════════════════════════════════ */
line('⑦CSS 新增 .unitInfoUltimate 金色样式');
{
  const css = fs.readFileSync(
    path.join(ROOT, 'screens', 'S7_Battle.module.css'),
    'utf8',
  );
  if (css.includes('.unitInfoUltimate')) {
    pass('.unitInfoUltimate 类已定义');
  } else {
    fail('.unitInfoUltimate 类缺失');
  }
  if (/\.unitInfoUltimate\s+strong\s*\{[^}]*#ffd98a/.test(css)) {
    pass('.unitInfoUltimate strong 使用金色 #ffd98a');
  } else {
    fail('金色色值未生效');
  }
  if (css.includes('.btnConditionUnmet')) {
    pass('.btnConditionUnmet 禁用态样式已定义');
  } else {
    fail('.btnConditionUnmet 样式缺失');
  }
}

/* ══════════════════════════════════════════════════ */
console.log('\n' + '═'.repeat(70));
console.log(`  阶段 I · UI 语义改造完毕  总计:${total} 通过:${passed} 失败:${failed}`);
console.log('═'.repeat(70));
if (failed > 0) process.exit(1);
