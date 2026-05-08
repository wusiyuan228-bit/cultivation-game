/**
 * stageM · P3 多段攻击 + P2 瞄准态文案精准化 · 静态审计
 *
 * 覆盖 2026-05-01 完工项：
 *   P3-1 宁风·其宝 engine 层 activeCast 改为只 emit 意图（不在 engine 做固伤）
 *   P3-2 宁风·其宝 store 层多攻击者轮流 resolveAttack 路由
 *   P3-3 马红俊·凤凰火雨 加入 multiSegmentSkills 路由
 *   P2-1 describeSelectorHint 支持按 candidateIds 推断目标归属
 *   P2-2 aimBar 调用传入 candidateIds/units/casterId
 *
 * 纯静态文本审计（不依赖 TypeScript 编译/运行环境）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// ROOT 指向 src/ （与 stageL 同构）
const ROOT = path.resolve(__dirname, '..', '..', '..');

let pass = 0;
let fail = 0;
const failures = [];

function log(ok, msg) {
  if (ok) {
    pass += 1;
    console.log(`  ✅ ${msg}`);
  } else {
    fail += 1;
    failures.push(msg);
    console.log(`  ❌ ${msg}`);
  }
}

function assertIncludes(relPath, needle, msg) {
  const full = path.join(ROOT, relPath);
  if (!fs.existsSync(full)) {
    log(false, `${msg}（文件不存在：${relPath}）`);
    return;
  }
  const content = fs.readFileSync(full, 'utf-8');
  log(content.includes(needle), msg);
}

function assertNotIncludes(relPath, needle, msg) {
  const full = path.join(ROOT, relPath);
  if (!fs.existsSync(full)) {
    log(false, `${msg}（文件不存在：${relPath}）`);
    return;
  }
  const content = fs.readFileSync(full, 'utf-8');
  log(!content.includes(needle), msg);
}

console.log('═══════════════════════════════════════════════════════════════');
console.log('  stageM · P3 多段攻击路由 + P2 瞄准态文案精准化');
console.log('═══════════════════════════════════════════════════════════════\n');

/* ─────────── P3-1 · 宁风·其宝 engine 层只 emit ─────────── */
console.log('【P3-1】宁风·其宝 activeCast 不做固伤、只 emit 意图');
const ningfengPath = 'systems/battle/skills/ningfeng_zengfu.ts';
assertNotIncludes(
  ningfengPath,
  "engine.changeStat(target.id, 'hp'",
  'ningfeng_zengfu 不再在 engine 层 changeStat(hp) 做固伤',
);
assertIncludes(
  ningfengPath,
  'store 层路由展开',
  'ningfeng_zengfu 备注改由 store 层路由展开',
);
assertIncludes(
  ningfengPath,
  'skill_active_cast',
  'ningfeng_zengfu 依然 emit 意图供 store 消费',
);

/* ─────────── P3-2 · 宁风·其宝 store 层多攻击者路由 ─────────── */
console.log('\n【P3-2】宁风·其宝 store 层 3 段协同攻击路由');
const storePath = 'stores/s7bBattleStore.ts';
assertIncludes(
  storePath,
  "regId === 'ssr_ningfengzhi.ult'",
  's7bBattleStore 识别 ssr_ningfengzhi.ult',
);
assertIncludes(
  storePath,
  'attackerOrder',
  's7bBattleStore 定义了 attackerOrder 数组（self + coAllies）',
);
assertIncludes(
  storePath,
  '协同友军本轮不消耗行动',
  's7bBattleStore 文案说明 Q43 协同友军本轮不消耗行动',
);

/* ─────────── P3-3 · 马红俊·凤凰火雨 加入 multiSegment 路由 ─────────── */
console.log('\n【P3-3】马红俊·凤凰火雨 加入 multiSegmentSkills 路由');
assertIncludes(
  storePath,
  "regId === 'sr_mahongjun.ultimate'",
  's7bBattleStore 识别 sr_mahongjun.ultimate 进入多段路由',
);
assertIncludes(
  storePath,
  '凤凰火雨 与 佛怒火莲/万毒淬体 同构',
  's7bBattleStore 文案说明 sr_mahongjun 是 all_adjacent_enemies 的多段结构',
);

/* ─────────── P2-1 · describeSelectorHint 支持 candidateIds 推断归属 ─────────── */
console.log('\n【P2-1】describeSelectorHint 按候选集归属动态文案');
const battlePath = 'screens/S7B_Battle.tsx';
assertIncludes(
  battlePath,
  '点击任意友军单位为目标',
  'describeSelectorHint 支持"点击任意友军"文案',
);
assertIncludes(
  battlePath,
  'allFriendly',
  'describeSelectorHint 用 allFriendly 识别纯友军候选集',
);
assertIncludes(
  battlePath,
  'allHostile',
  'describeSelectorHint 用 allHostile 识别纯敌方候选集',
);
assertNotIncludes(
  battlePath,
  '点击任意单位（敌/友）为目标',
  '旧版"敌/友"模糊文案已被替换',
);

/* ─────────── P2-2 · aimBar 调用传入完整上下文 ─────────── */
console.log('\n【P2-2】aimBar 调用传入 candidateIds + units + casterId');
assertIncludes(
  battlePath,
  'candidateIds: ultimateTargeting.candidateIds',
  'aimBar describeSelectorHint 调用传入 candidateIds',
);
assertIncludes(
  battlePath,
  'casterId: ultimateTargeting.casterId',
  'aimBar describeSelectorHint 调用传入 casterId',
);

/* ─────────── P2-3 · single_any_character 类 precheck 正确过滤 ─────────── */
console.log('\n【P2-3】single_any_character 类技能 precheck 正确过滤为友军候选');
const charPickSkills = [
  { file: 'systems/battle/skills/tangya_shengming.ts', skill: '唐雅·蓝银皇生命赐福' },
  { file: 'systems/battle/skills/yaochen_danyi.ts', skill: '药尘·丹帝遗方' },
];
for (const { file, skill } of charPickSkills) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) {
    log(false, `${skill}：文件不存在 (${full})`);
    continue;
  }
  const content = fs.readFileSync(full, 'utf-8');
  log(
    content.includes('getAlliesOf') && content.includes('candidateIds'),
    `${skill}：precheck 使用 getAlliesOf + candidateIds 过滤为友军（UI 瞄准态自动识别为"选友军"）`,
  );
}

/* ─────────── P2-4 · position_pick 小战祖树盾位置选 ─────────── */
console.log('\n【P2-4】position_pick selector 与小战祖树盾位置选交互');
assertIncludes(
  'systems/battle/types.ts',
  "'position_pick'",
  'types.ts 新增 position_pick selector 类型',
);
assertIncludes(
  'systems/battle/skillCastability.ts',
  "case 'position_pick':",
  'skillCastability 识别 position_pick（无条件可放）',
);
assertIncludes(
  'systems/battle/skills/xiaozhan_zushudun.ts',
  "targetSelector: { kind: 'position_pick' }",
  '小战祖树盾改用 position_pick selector',
);
assertNotIncludes(
  'systems/battle/skills/xiaozhan_zushudun.ts',
  "targetSelector: { kind: 'none' }",
  '小战祖树盾不再是 none（避免无目标误放）',
);
assertIncludes(
  battlePath,
  'position_pick',
  'S7B_Battle 支持 position_pick 瞄准态',
);
assertIncludes(
  battlePath,
  '点击棋盘任意空格子放置障碍',
  'describeSelectorHint 为 position_pick 提供提示文案',
);
assertIncludes(
  battlePath,
  'isPositionPickAim',
  'S7B_Battle 计算合法空格子高亮标识',
);
assertIncludes(
  battlePath,
  'battle.performUltimate(casterId, [], { row, col })',
  'S7B_Battle 以 pickedPosition 参数调用 performUltimate',
);
assertIncludes(
  storePath,
  "regId === 'bsr_xiaozhan.ult' && pickedPosition",
  's7bBattleStore 接收 pickedPosition 并写入障碍',
);
assertIncludes(
  storePath,
  "newMap[pr][pc].terrain = 'obstacle'",
  's7bBattleStore 将选中格改为 obstacle terrain',
);
assertIncludes(
  'utils/s7bAI.ts',
  'pickPositionForAI',
  'AI 层实现 position_pick 的自动选格策略',
);
assertIncludes(
  'utils/s7bAI.ts',
  "kind === 'position_pick'",
  'AI 层 evaluateUltimate 覆盖 position_pick selector',
);

/* ─────────── P2-5 · 21 条 hook 技能日志透明化（MVP 自动选择注明） ─────────── */
console.log('\n【P2-5】hook 类技能日志注明"自动选择 · 理由"');
const transparentSkills = [
  { file: 'systems/battle/skills/aoska_xiangchang.ts', mark: '自动选择 · 最缺血', name: '奥斯卡·大香肠' },
  { file: 'systems/battle/skills/ningrongrong_qibao.ts', mark: '自动选择 · atk最低', name: '宁荣荣·七宝' },
  { file: 'systems/battle/skills/guhe_juyuan.ts', mark: '自动选择 · 首个相邻友军', name: '菇荷·聚元' },
  { file: 'systems/battle/skills/yunquezi_qieyuan.ts', mark: '自动选择 · 相邻敌', name: '云雀子·窃元' },
  { file: 'systems/battle/skills/hongdie_diewu.ts', mark: '自动选择 · 首个绝技未用的敌方', name: '红蝶·蝶舞' },
  { file: 'systems/battle/skills/tianyunzi_yinguo.ts', mark: '友军自动选择 · hp最低的相邻友军', name: '天云子·因果' },
  { file: 'systems/battle/skills/yaochen_lenghuo.ts', mark: '自动选择 · hp最低的相邻友军', name: '药尘·冷火' },
  { file: 'systems/battle/skills/qianrenxue_tianshi.ts', mark: '自动发动 · 心境充足', name: '千仞雪·天使' },
  { file: 'systems/battle/skills/yinyue_yuehua.ts', mark: '自动发动 · 受伤≥3', name: '银月·月华' },
  { file: 'systems/battle/skills/nangongwan_guiyuan.ts', mark: '自动选择 · atk最高的敌人', name: '南宫婉·归元' },
  { file: 'systems/battle/skills/meidusa_shihua.ts', mark: '自动选择 · atk最高的敌人', name: '美杜莎·石化' },
  { file: 'systems/battle/skills/tuosen_fengyin.ts', mark: '自动选择 · hp最低的敌人', name: '托森·封印' },
  { file: 'systems/battle/skills/tianyunzi_minge.ts', mark: '自动选择 · atk最高的相邻敌', name: '天云子·民歌' },
  { file: 'systems/battle/skills/xiaoxuan_tianyan.ts', mark: '自动选择 · 前3个绝技已用的友军', name: '小悬·天眼' },
  { file: 'systems/battle/skills/xiaoyixian_dushigu.ts', mark: '自动选择 · hp最低的相邻敌', name: '小炎·毒使骨' },
  { file: 'systems/battle/skills/tangya_lanyin.ts', mark: '自动选择 · hp最低的友军', name: '唐雅·蓝银' },
  { file: 'systems/battle/skills/yuanyao_bini.ts', mark: '自动选择 · 第一个非主角敌方', name: '元耀·必逆' },
  { file: 'systems/battle/skills/nalanyanran_fengshu.ts', mark: '自动执行 · 当前被击目标', name: '那兰·风枢' },
  { file: 'systems/battle/skills/tenghuayuan_sousen.ts', mark: '自动选择 · 最近敌方', name: '藤花原·搜森' },
  { file: 'systems/battle/skills/nangongwan_wanhua.ts', mark: '自动发动 · hp≥2 时默认启动', name: '南宫婉·万华' },
  { file: 'systems/battle/skills/bingfeng_hanxiao.ts', mark: '自动发动 · 合并收益优于原防御', name: '冰凤·寒啸' },
];
for (const { file, mark, name } of transparentSkills) {
  assertIncludes(file, mark, `${name}：emit narrative 注明"${mark}"`);
}

/* ─────────── 打印结果 ─────────── */
console.log('\n═══════════════════════════════════════════════════════════════');
console.log(`  stageM 审计结果：${pass} 通过 / ${fail} 失败`);
console.log('═══════════════════════════════════════════════════════════════');
if (fail > 0) {
  console.log('\n❌ 失败项：');
  failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
  process.exit(1);
}
