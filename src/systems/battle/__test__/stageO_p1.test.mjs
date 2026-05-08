/**
 * stageO · P1 · 唐昊破天真掷骰 + 穹古阴阳万解真实重投 回归测试
 *
 * 关注：
 *   ① tanghao_potian.ts activeCast 已从"calcLog/changeStat -5"改为"发意图，由 store 路由"
 *   ② s7bBattleStore multiSegmentSkills 包含 bssr_tanghao.ult 分支（diceOverride = atk+5）
 *   ③ xuangu_yinyang.ts 从 atk×3 近似改为真实 3 面骰重投 rerollThreeFaceDice
 *   ④ xuangu 加了攻方身份守卫 __firingUnitIsAttacker__
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../../../');
const SRC = path.join(ROOT, 'src');

let pass = 0;
let fail = 0;
const okfn = (m) => { console.log(`  ✅ ${m}`); pass++; };
const bad = (m) => { console.log(`  ❌ ${m}`); fail++; };

const read = (p) => fs.readFileSync(p, 'utf8');

console.log('\n━━━━━━ ① 唐昊·破天 activeCast 只发意图，不再 hp -5 ━━━━━━');
{
  const src = read(path.join(SRC, 'systems/battle/skills/tanghao_potian.ts'));
  !src.includes("engine.changeStat(target.id, 'hp', -5")
    ? okfn('activeCast 移除了旧的 hp -5 近似')
    : bad('activeCast 仍保留 hp -5 近似');
  !src.match(/damage:\s*5,\s*fixed:\s*true/)
    ? okfn('activeCast 不再 emit 固定 5 点伤害')
    : bad('activeCast 仍 emit 固定 5 点伤害');
  src.includes('skill_active_cast') && src.includes('extraDice: 5')
    ? okfn('activeCast 仅保留 skill_active_cast 意图 emit')
    : bad('activeCast 缺少意图 emit');
}

console.log('\n━━━━━━ ② s7bBattleStore multiSegmentSkills 加入唐昊分支 ━━━━━━');
{
  const src = read(path.join(SRC, 'stores/s7bBattleStore.ts'));
  src.includes("regId === 'bssr_tanghao.ult'")
    ? okfn('multiSegmentSkills 入口包含 bssr_tanghao.ult')
    : bad('multiSegmentSkills 未包含唐昊');
  src.match(/regId === 'bssr_tanghao\.ult'\s*\n\s*\?\s*\(self[^)]*\)\s*=>\s*self\.atk\s*\+\s*5/)
    ? okfn('唐昊分支 diceOverride 配置为 self.atk + 5')
    : bad('唐昊分支 diceOverride 配置缺失或错误');
}

console.log('\n━━━━━━ ③ 阴阳万解：真实重投 + 取高 ━━━━━━');
{
  const src = read(path.join(SRC, 'systems/battle/skills/xuangu_yinyang.ts'));
  src.includes('rerollThreeFaceDice')
    ? okfn('xuangu_yinyang.ts 定义了 rerollThreeFaceDice')
    : bad('xuangu_yinyang.ts 缺少真实重投函数');
  src.includes('Math.floor(Math.random() * 3)')
    ? okfn('rerollThreeFaceDice 是真实 3 面骰（0/1/2）')
    : bad('rerollThreeFaceDice 不是真实 3 面骰');
  src.includes('if (rerollSum > ctx.aSum)')
    ? okfn('重投取高逻辑（仅在重投>原值时替换）')
    : bad('缺少取高逻辑');
  !src.includes('self.atk.current * 3')
    ? okfn('移除了 atk×3 的近似')
    : bad('仍残留 atk×3 近似');
  src.includes('__firingUnitIsAttacker__')
    ? okfn('加了攻方身份守卫（Q35）')
    : bad('缺少 __firingUnitIsAttacker__ 守卫');
  src.includes('ctx.hookFiredSet')
    ? okfn('Q47 防递归保护仍保留')
    : bad('Q47 防递归保护丢失');
}

console.log('\n══════════════════════════════════════════════════════════════════════');
console.log(`  stageO · P1 精确版数值回归  总计:${pass+fail} 通过:${pass} 失败:${fail}`);
console.log('══════════════════════════════════════════════════════════════════════');

process.exit(fail === 0 ? 0 : 1);
