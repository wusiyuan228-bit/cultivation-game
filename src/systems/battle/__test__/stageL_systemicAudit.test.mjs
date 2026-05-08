/**
 * stageL · 系统性审计测试（2026-05-01 生产复盘）
 *
 * 覆盖本轮 4 类系统性漏洞的防护：
 *
 *   R1. SKILL_NAME_TO_REGISTRY_ID 漏注册导致 hook 挂不上 —— ~86 条技能全军覆没
 *       修复：s7bBattleStore 走 SkillRegistry.findIdByName（自动覆盖全部实装）
 *
 *   R2. resolveAttack.ts fireHooksOf 未注入 __firingUnitIsAttacker__
 *       修复：统一在 fire 时注入身份标记
 *
 *   R3. on_damage_calc 双向派发导致"攻方 buff"被"守方身份"错误触发
 *       修复：tanghao_po / xiaoxuan_fen / hanli_aw_chongjin / zhouyi_fengmo 均加入
 *             __firingUnitIsAttacker__ 身份守卫
 *
 *   R4. resolveAttack.ts Phase ① 加减循环未排除 __cap__，封顶 delta 被当加项
 *       修复：Phase ① 跳过 __cap__；Phase ④ 独立做 min() 封顶
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
console.log('  阶段 L · 系统性审计（R1~R4）');
console.log('═'.repeat(70));

/* ══════════════════════════════════════════════════ */
/*  R1 · 技能名映射自动覆盖                             */
/* ══════════════════════════════════════════════════ */
line('R1 · s7bBattleStore 使用 SkillRegistry.findIdByName 作为主反查');
{
  const storeSrc = fs.readFileSync(
    path.join(ROOT, 'stores', 's7bBattleStore.ts'),
    'utf8',
  );
  if (storeSrc.includes('SkillRegistry.findIdByName')) {
    pass('store 直接调用 SkillRegistry.findIdByName（覆盖全部 112 条实装）');
  } else {
    fail('store 未使用 SkillRegistry.findIdByName，仍依赖不全的老映射表');
  }
  if (storeSrc.includes('function resolveSkillRegId') || storeSrc.includes('resolveSkillRegId(')) {
    pass('store 导出统一 resolveSkillRegId 函数');
  } else {
    fail('store 未封装 resolveSkillRegId');
  }
  // performUltimate / ultimatePrecheck / buildRegistrySkills 都必须用新函数
  const useCount = (storeSrc.match(/resolveSkillRegId\(/g) || []).length;
  if (useCount >= 4) {
    pass(`resolveSkillRegId 被调用 ${useCount} 处（覆盖 buildRegistrySkills + precheck + perform）`);
  } else {
    fail(`resolveSkillRegId 调用次数不足，仅 ${useCount} 处`);
  }
}

/* ══════════════════════════════════════════════════ */
/*  R1 · registry 注册数 vs 技能文件数一致                 */
/* ══════════════════════════════════════════════════ */
line('R1.b · skillRegistry.ts 每个技能文件都被 import + register');
{
  const regSrc = fs.readFileSync(
    path.join(ROOT, 'systems', 'battle', 'skillRegistry.ts'),
    'utf8',
  );
  const skillsDir = path.join(ROOT, 'systems', 'battle', 'skills');
  const fileCount = fs.readdirSync(skillsDir).filter((f) => f.endsWith('.ts')).length;
  const importCount = (regSrc.match(/^import \{ skill_/gm) || []).length;
  const registerCount = (regSrc.match(/SkillRegistry\.register\(/g) || []).length;

  if (fileCount === importCount) {
    pass(`技能文件数=${fileCount}，import 数=${importCount} 一致`);
  } else {
    fail(`技能文件数=${fileCount}，但 import 数=${importCount} 不一致`);
  }
  if (fileCount === registerCount) {
    pass(`技能文件数=${fileCount}，register 数=${registerCount} 一致`);
  } else {
    fail(`技能文件数=${fileCount}，但 register 数=${registerCount} 不一致`);
  }
}

/* ══════════════════════════════════════════════════ */
/*  R2 · resolveAttack fireHooksOf 注入身份标记           */
/* ══════════════════════════════════════════════════ */
line('R2 · resolveAttack.ts fireHooksOf 注入 __firingUnitIsAttacker__');
{
  const resolveSrc = fs.readFileSync(
    path.join(ROOT, 'systems', 'battle', 'resolveAttack.ts'),
    'utf8',
  );
  if (resolveSrc.includes('__firingUnitIsAttacker__')) {
    pass('resolveAttack.ts 注入了 __firingUnitIsAttacker__');
  } else {
    fail('resolveAttack.ts 未注入 __firingUnitIsAttacker__');
  }
  if (resolveSrc.includes('unit.id === ctx.attacker.id')) {
    pass('fireHooksOf 用 unit.id === ctx.attacker.id 判定身份');
  } else {
    fail('fireHooksOf 未做身份判定');
  }
  // clear 防止串污
  if (resolveSrc.includes('__firingUnitIsAttacker__ = undefined')) {
    pass('fireHooksOf 结束后清除标记');
  } else {
    fail('fireHooksOf 未清除标记');
  }
}

/* ══════════════════════════════════════════════════ */
/*  R3 · 仅攻方生效的 hook 都有身份守卫                    */
/* ══════════════════════════════════════════════════ */
line('R3 · on_damage_calc 攻方 buff 均加身份守卫');
{
  const guardedSkills = [
    { file: 'tanghao_po.ts', name: '昊天锤·碎' },
    { file: 'xiaoxuan_fen.ts', name: '萧族斗气·焚' },
    { file: 'hanli_aw_chongjin.ts', name: '噬金虫群（致命：伤害×2）' },
    { file: 'zhouyi_fengmo.ts', name: '疯魔·灭杀' },
  ];
  for (const s of guardedSkills) {
    const src = fs.readFileSync(
      path.join(ROOT, 'systems', 'battle', 'skills', s.file),
      'utf8',
    );
    if (src.includes('__firingUnitIsAttacker__ !== true') || src.includes('__firingUnitIsAttacker__ === false')) {
      pass(`${s.name} 已加身份守卫`);
    } else {
      fail(`${s.name} 未加身份守卫（可能误为攻击方加 buff）`);
    }
  }
  // xiaowu_wudi 历史修复依然有效
  const wudiSrc = fs.readFileSync(
    path.join(ROOT, 'systems', 'battle', 'skills', 'xiaowu_wudi.ts'),
    'utf8',
  );
  if (wudiSrc.includes('__firingUnitIsAttacker__')) {
    pass('无敌金身历史身份守卫保持');
  } else {
    fail('无敌金身的历史身份守卫被意外移除');
  }
}

/* ══════════════════════════════════════════════════ */
/*  R4 · resolveAttack Phase ① 跳过 __cap__              */
/* ══════════════════════════════════════════════════ */
line('R4 · resolveAttack.ts Phase ① 跳过 __cap__，Phase ④ 独立封顶');
{
  const src = fs.readFileSync(
    path.join(ROOT, 'systems', 'battle', 'resolveAttack.ts'),
    'utf8',
  );
  if (/entry\.source\.endsWith\('__cap__'\)\)\s*continue/.test(src)) {
    pass('Phase ① 加减循环显式跳过 __cap__');
  } else {
    fail('Phase ① 未跳过 __cap__（封顶 delta 会被误加）');
  }
  if (/Math\.min\(damage,\s*entry\.delta\)/.test(src)) {
    pass('Phase ④ 独立做 Math.min 封顶');
  } else {
    fail('Phase ④ 未独立 min 封顶');
  }
}

/* ══════════════════════════════════════════════════ */
/*  小结                                                */
/* ══════════════════════════════════════════════════ */
console.log('\n' + '═'.repeat(70));
console.log(`  阶段 L 结果：${passed}/${total} 通过${failed > 0 ? `，${failed} 失败` : ''}`);
console.log('═'.repeat(70));
process.exit(failed > 0 ? 1 : 0);
