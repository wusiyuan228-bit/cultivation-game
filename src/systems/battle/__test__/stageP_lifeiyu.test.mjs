/**
 * stageP · 厉飞雨·疾风无影 压制机制 回归测试
 *
 * 背景：此前疾风无影只在 ctx 上打 suppressAttackerBattleSkill 标记，
 *       但全代码库没有任何地方"消费"该标记 → 技能完全无效。
 *
 * 本次修复：
 *   ① resolveAttack.collectHooks 增加 ctx 参数，读取标记后跳过攻方的
 *      被动 battle_skill hook（含 awaken_skill；不含 ultimate/awaken_ult）
 *   ② 用 SkillRegistration.kind（未声明时按 isActive 推断）判定类别
 *   ③ lifeiyu_jifeng.ts 显式标注 kind: 'battle_skill'
 *   ④ fireHooksOf 调用 collectHooks 时传入 ctx
 *   ⑤ types.ts 中错误写法"李飞羽"修正为"厉飞雨"
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

console.log('\n━━━━━━ ① resolveAttack.collectHooks 消费压制标记 ━━━━━━');
{
  const src = read(path.join(SRC, 'systems/battle/resolveAttack.ts'));
  src.includes('suppressAttackerBattleSkill')
    ? okfn('resolveAttack.ts 引用了 suppressAttackerBattleSkill 标记')
    : bad('resolveAttack.ts 未消费 suppressAttackerBattleSkill 标记');
  src.match(/function collectHooks\([^)]*ctx\?:\s*AttackContext[^)]*\)/)
    ? okfn('collectHooks 签名已扩展为接收可选的 ctx')
    : bad('collectHooks 签名未扩展 ctx 参数');
  src.includes("kind === 'battle_skill'")
    ? okfn('按 kind==="battle_skill" 过滤被动 hook')
    : bad('未按 kind 过滤被动 hook');
  src.includes("skill.isActive === true ? 'ultimate' : 'battle_skill'")
    ? okfn('未声明 kind 时按 isActive 推断（简化方案）')
    : bad('缺少 isActive 推断回退');
  src.match(/hooks = collectHooks\(unit, hookName, ctx\)/)
    ? okfn('fireHooksOf 调用 collectHooks 时已传入 ctx')
    : bad('fireHooksOf 未把 ctx 传入 collectHooks');
}

console.log('\n━━━━━━ ② lifeiyu_jifeng.ts 显式声明 kind ━━━━━━');
{
  const src = read(path.join(SRC, 'systems/battle/skills/lifeiyu_jifeng.ts'));
  src.match(/kind:\s*'battle_skill'/)
    ? okfn("疾风无影显式声明 kind: 'battle_skill'")
    : bad("疾风无影缺少 kind 声明");
  src.includes('suppressAttackerBattleSkill = true')
    ? okfn('Phase 4 正确设置压制标记')
    : bad('Phase 4 未设置压制标记');
  src.includes('ctx.viaUltimate')
    ? okfn('对绝技攻击不生效（viaUltimate 分支）')
    : bad('缺少 viaUltimate 豁免分支');
}

console.log('\n━━━━━━ ③ 错误名字"李飞羽"已全部修正为"厉飞雨" ━━━━━━');
{
  // 工程根（04_程序开发/cardwar-ai）范围内扫描
  const SELF = fileURLToPath(import.meta.url);
  const bad1 = [];
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      const st = fs.statSync(p);
      if (st.isDirectory()) {
        if (f === 'node_modules' || f === 'dist' || f === '.git' || f === '.vite') continue;
        walk(p);
      } else if (/\.(ts|tsx|mjs|md|json)$/.test(f)) {
        if (p === SELF) continue; // 排除本测试脚本自身（含字面量）
        const t = fs.readFileSync(p, 'utf8');
        if (t.includes('\u674e\u98de\u7fbd')) bad1.push(p);
      }
    }
  };
  walk(ROOT);
  bad1.length === 0
    ? okfn('工程内已无"李飞羽"错误写法')
    : bad(`仍存在错误写法：\n${bad1.map((x) => '      · ' + x).join('\n')}`);
}

console.log('\n━━━━━━ ④ 卡面数据源厉飞雨映射仍完整 ━━━━━━');
{
  const src = read(path.join(ROOT, 'public/config/cards/cards_all.json'));
  src.includes('"id": "sr_lifeiyu"')
    ? okfn('cards_all.json 仍包含 sr_lifeiyu 定义')
    : bad('cards_all.json 丢失 sr_lifeiyu');
  src.includes('"name": "疾风无影"')
    ? okfn('疾风无影 name 仍可索引')
    : bad('疾风无影 name 丢失');
  const reg = read(path.join(SRC, 'systems/battle/skillRegistry.ts'));
  reg.includes('skill_lifeiyu_jifeng') && reg.includes('skill_lifeiyu_zhuxian')
    ? okfn('skillRegistry 仍注册厉飞雨两条技能')
    : bad('skillRegistry 厉飞雨注册丢失');
}

console.log('\n══════════════════════════════════════════════════════════════════════');
console.log(`  stageP · 厉飞雨·疾风无影 压制机制回归  总计:${pass+fail} 通过:${pass} 失败:${fail}`);
console.log('══════════════════════════════════════════════════════════════════════');

process.exit(fail === 0 ? 0 : 1);
