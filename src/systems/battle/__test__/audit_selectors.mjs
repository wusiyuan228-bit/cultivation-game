/**
 * 侦察脚本：扫描所有 SkillRegistration，提取：
 *   - 技能ID
 *   - isActive
 *   - targetSelector.kind（如果有）
 *   - name（尝试从 desc 字段或注释/文件名推测）
 *
 * 输出 CSV 风格的表，便于人工审阅"哪些 selector 与技能文案不匹配"
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SKILL_DIR = path.resolve(__dirname, '..', 'skills');

const files = fs.readdirSync(SKILL_DIR).filter(f => f.endsWith('.ts'));

const rows = [];
for (const f of files) {
  const src = fs.readFileSync(path.join(SKILL_DIR, f), 'utf8');

  // 提取 id
  const idMatch = src.match(/id:\s*['"]([^'"]+)['"]/);
  const id = idMatch ? idMatch[1] : '?';

  // 提取 isActive
  const isActive = /isActive:\s*true/.test(src);

  // 提取 targetSelector.kind
  const kindMatch = src.match(/kind:\s*['"]([^'"]+)['"]/);
  const kind = kindMatch ? kindMatch[1] : (isActive ? '(缺失!)' : '-');

  // 是否有 activeCast 方法
  const hasActiveCast = /activeCast\s*[:(]/.test(src);

  // 猜测技能类型（从 id 后缀）
  const isUltimate =
    id.includes('ultimate') ||
    id.includes('aw_') ||
    hasActiveCast && isActive;

  rows.push({ file: f, id, isActive, kind, hasActiveCast });
}

// 按 isActive + kind 分组
console.log('═'.repeat(100));
console.log('  技能 selector 全量扫描');
console.log('═'.repeat(100));
console.log();

// 分类
const passive = rows.filter(r => !r.isActive && !r.hasActiveCast);
const activeSkills = rows.filter(r => r.isActive || r.hasActiveCast);

console.log(`  被动技能（无按钮）：${passive.length} 条`);
console.log(`  主动技/绝技（需按钮）：${activeSkills.length} 条`);
console.log();

// 按 selector 聚合
const byKind = {};
for (const r of activeSkills) {
  const k = r.kind;
  if (!byKind[k]) byKind[k] = [];
  byKind[k].push(r);
}

const kindSortOrder = [
  '(缺失!)',
  'single_adjacent_enemy', 'all_adjacent_enemies', 'cross_adjacent_enemies',
  'single_any_enemy', 'single_line_enemy', 'all_enemies',
  'single_any_character', 'all_allies_incl_self', 'none',
];

for (const kind of kindSortOrder) {
  const list = byKind[kind];
  if (!list || list.length === 0) continue;
  console.log(`\n━━━━ kind=${kind}  (${list.length}条)  ━━━━`);
  for (const r of list) {
    console.log(`    ${r.id.padEnd(40)}  [${r.file}]`);
  }
  delete byKind[kind];
}

// 其它 kind
for (const [kind, list] of Object.entries(byKind)) {
  console.log(`\n━━━━ kind=${kind}  (${list.length}条) ━━━━`);
  for (const r of list) console.log(`    ${r.id}  [${r.file}]`);
}

console.log('\n' + '═'.repeat(100));
console.log(`  总计：被动 ${passive.length} + 主动 ${activeSkills.length} = ${rows.length}`);
console.log('═'.repeat(100));
