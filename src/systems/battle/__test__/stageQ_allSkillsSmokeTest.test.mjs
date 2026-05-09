/**
 * stageQ · 全技能实装冒烟测试（2026-05-09 决策④）
 *
 * 目标：
 *   - 遍历 SkillRegistry 全部 112 条注册技能
 *   - 对每条技能做静态检查：是否真正挂 hook / activeCast / autoModifiers
 *   - 分类统计：被动技（挂 hook）/ 主动绝技（activeCast）/ 空壳 / 待实装
 *   - 最终输出一份清晰的 Markdown 风格报告，卡在终端里也能读
 *
 * 注意：这是"静态分析"，不实际跑战斗。运行时正确性由 stageA~P 覆盖。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../../../');
const SRC = path.join(ROOT, 'src');
const SKILLS_DIR = path.join(SRC, 'systems/battle/skills');
const REGISTRY_FILE = path.join(SRC, 'systems/battle/skillRegistry.ts');

const read = (p) => fs.readFileSync(p, 'utf8');

let pass = 0;
let fail = 0;
const okfn = (m) => { console.log(`  ✅ ${m}`); pass++; };
const bad = (m) => { console.log(`  ❌ ${m}`); fail++; };

console.log('═'.repeat(72));
console.log('  阶段 Q · 全技能实装冒烟测试（覆盖 SkillRegistry 全部实装）');
console.log('═'.repeat(72));

/* ══════════════════════════════════════════════════════════════ */
/*  ① 读 skillRegistry.ts 拉出全部 register 行                     */
/* ══════════════════════════════════════════════════════════════ */
const regSrc = read(REGISTRY_FILE);
const registerIds = [...regSrc.matchAll(/SkillRegistry\.register\((skill_\w+)\)/g)].map((m) => m[1]);
console.log(`\n📋 SkillRegistry 共注册 ${registerIds.length} 条技能`);

/* ══════════════════════════════════════════════════════════════ */
/*  ② 遍历每一条技能，读对应技能文件做静态分析                       */
/* ══════════════════════════════════════════════════════════════ */
const categories = {
  passive_hook: [],        // 被动技：至少挂了一个 hook
  active_cast: [],         // 主动技：有 activeCast
  auto_modifier: [],       // 纯 autoModifiers（觉醒上场自带 buff）
  on_pos_change: [],       // 位置变化响应（古元天火阵等）
  empty_shell: [],         // 空壳：既无 hook / activeCast / autoModifiers / onPositionChange
  file_missing: [],        // 注册了但文件缺失
};

const SKILL_FILES = new Map(); // skillVar -> filename
for (const fn of fs.readdirSync(SKILLS_DIR)) {
  if (!fn.endsWith('.ts')) continue;
  const src = read(path.join(SKILLS_DIR, fn));
  // 抓每个 export const skill_xxx
  for (const m of src.matchAll(/export const (skill_\w+)[^=]*=\s*{([\s\S]*?)^};?/gm)) {
    const [, varName, body] = m;
    SKILL_FILES.set(varName, { file: fn, body });
  }
}

for (const id of registerIds) {
  const entry = SKILL_FILES.get(id);
  if (!entry) {
    categories.file_missing.push(id);
    continue;
  }
  const { body } = entry;
  const hasHook = /hooks:\s*\{[^}]*on_\w+:/s.test(body) && !/hooks:\s*\{\s*\}/.test(body);
  const hasActive = /activeCast\s*:/.test(body);
  const hasAutoMod = /autoModifiers\s*:/.test(body);
  const hasPosChange = /onPositionChange\s*:/.test(body);

  if (hasActive) categories.active_cast.push(id);
  else if (hasHook) categories.passive_hook.push(id);
  else if (hasAutoMod) categories.auto_modifier.push(id);
  else if (hasPosChange) categories.on_pos_change.push(id);
  else categories.empty_shell.push(id);
}

/* ══════════════════════════════════════════════════════════════ */
/*  ③ 报告                                                         */
/* ══════════════════════════════════════════════════════════════ */
console.log('\n━━━━━━ Ⓐ 被动技（挂 hook） ━━━━━━');
console.log(`  共 ${categories.passive_hook.length} 条`);
if (categories.passive_hook.length > 0) {
  console.log(`  示例: ${categories.passive_hook.slice(0, 5).join(', ')}${categories.passive_hook.length > 5 ? ' ...' : ''}`);
}
if (categories.passive_hook.length >= 60) okfn(`被动技覆盖充分（≥60 条）`);
else bad(`被动技数量偏少：${categories.passive_hook.length}`);

console.log('\n━━━━━━ Ⓑ 主动绝技（activeCast） ━━━━━━');
console.log(`  共 ${categories.active_cast.length} 条`);
if (categories.active_cast.length > 0) {
  console.log(`  示例: ${categories.active_cast.slice(0, 5).join(', ')}${categories.active_cast.length > 5 ? ' ...' : ''}`);
}
if (categories.active_cast.length >= 10) okfn(`主动绝技覆盖充分（≥10 条）`);
else bad(`主动绝技数量偏少：${categories.active_cast.length}`);

console.log('\n━━━━━━ Ⓒ 纯 autoModifier（觉醒即挂 buff） ━━━━━━');
console.log(`  共 ${categories.auto_modifier.length} 条`);
if (categories.auto_modifier.length > 0) {
  console.log(`  示例: ${categories.auto_modifier.slice(0, 5).join(', ')}`);
}

console.log('\n━━━━━━ Ⓓ onPositionChange（光环重算类） ━━━━━━');
console.log(`  共 ${categories.on_pos_change.length} 条`);
if (categories.on_pos_change.length > 0) {
  console.log(`  示例: ${categories.on_pos_change.join(', ')}`);
}

console.log('\n━━━━━━ Ⓔ 空壳技能（无实装，需关注） ━━━━━━');
console.log(`  共 ${categories.empty_shell.length} 条`);
if (categories.empty_shell.length > 0) {
  for (const id of categories.empty_shell) {
    console.log(`    ⚠️  ${id}（${SKILL_FILES.get(id)?.file ?? '?'}）`);
  }
  bad(`存在 ${categories.empty_shell.length} 条空壳技能`);
} else {
  okfn('无空壳技能 —— 全部技能都有具体实装入口');
}

console.log('\n━━━━━━ Ⓕ 注册但文件缺失（严重错误） ━━━━━━');
console.log(`  共 ${categories.file_missing.length} 条`);
if (categories.file_missing.length > 0) {
  for (const id of categories.file_missing) {
    console.log(`    ❌ ${id}（文件未找到）`);
  }
  bad(`${categories.file_missing.length} 条技能声明了 register 但文件不存在`);
} else {
  okfn('所有 register 条目都有对应源文件');
}

/* ══════════════════════════════════════════════════════════════ */
/*  ④ SkillRegistry 中技能 name 字段全部非空检查                   */
/* ══════════════════════════════════════════════════════════════ */
console.log('\n━━━━━━ Ⓖ 技能 name 字段完整性 ━━━━━━');
{
  let missing = 0;
  for (const [, { file, body }] of SKILL_FILES) {
    if (!/name:\s*['"`][^'"`]+['"`]/.test(body)) {
      missing++;
      console.log(`    ⚠️  ${file} 技能缺 name 字段`);
    }
  }
  if (missing === 0) okfn('全部技能文件都有 name 字段');
  else bad(`${missing} 个技能缺 name 字段`);
}

/* ══════════════════════════════════════════════════════════════ */
/*  ⑤ SkillRegistry 中技能 description 非空（未揭示时显示效果未知） */
/* ══════════════════════════════════════════════════════════════ */
console.log('\n━━━━━━ Ⓗ 技能 description 字段完整性 ━━━━━━');
{
  let missing = 0;
  for (const [, { file, body }] of SKILL_FILES) {
    if (!/description:\s*['"`]/.test(body)) {
      missing++;
      console.log(`    ⚠️  ${file} 缺 description 字段`);
    }
  }
  if (missing === 0) okfn('全部技能文件都有 description 字段');
  else bad(`${missing} 个技能缺 description 字段`);
}

/* ══════════════════════════════════════════════════════════════ */
/*  ⑥ S7A battleStore 是否已接入新引擎（本轮重构 smoke）            */
/* ══════════════════════════════════════════════════════════════ */
console.log('\n━━━━━━ Ⓘ S7A battleStore 接入新引擎 (阶段一) ━━━━━━');
{
  const src = read(path.join(SRC, 'stores/battleStore.ts'));
  src.includes('SkillRegistry.findIdByName')
    ? okfn('battleStore 使用 SkillRegistry.findIdByName 自动反查')
    : bad('battleStore 未使用 SkillRegistry.findIdByName');
  src.includes('mapUnitToEngine')
    ? okfn('battleStore 有 mapUnitToEngine 桥接')
    : bad('battleStore 缺 mapUnitToEngine');
  src.includes('fireHooks') && src.includes('on_before_roll') && src.includes('on_after_hit')
    ? okfn('battleStore attack 方法挂载了 7-phase hook')
    : bad('battleStore attack 未接 7-phase hook');
  src.includes('performUltimate') && src.includes('activeCast')
    ? okfn('battleStore 实现了 performUltimate 主动绝技路径')
    : bad('battleStore 未实现 performUltimate');
  src.includes('ultimatePrecheck')
    ? okfn('battleStore 提供 ultimatePrecheck 供 UI 查询')
    : bad('battleStore 缺 ultimatePrecheck');
}

/* ══════════════════════════════════════════════════════════════ */
/*  ⑦ 汇总                                                         */
/* ══════════════════════════════════════════════════════════════ */
console.log('\n' + '═'.repeat(72));
console.log(`  📊 分类汇总：`);
console.log(`    Ⓐ 被动技（挂 hook）：${categories.passive_hook.length}`);
console.log(`    Ⓑ 主动绝技：${categories.active_cast.length}`);
console.log(`    Ⓒ 纯 autoModifier：${categories.auto_modifier.length}`);
console.log(`    Ⓓ onPositionChange：${categories.on_pos_change.length}`);
console.log(`    Ⓔ 空壳（待实装）：${categories.empty_shell.length}`);
console.log(`    Ⓕ 文件缺失：${categories.file_missing.length}`);
console.log(`    合计：${registerIds.length}`);
console.log(`  🏁 测试检查：${pass} pass / ${fail} fail`);
console.log('═'.repeat(72));

if (fail > 0) process.exit(1);
