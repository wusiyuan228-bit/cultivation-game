/**
 * 一次性为 pool_r 和 heroes.battle_card 的每张抽卡技能补齐 params 参数
 * 用法：node scripts/patch_run_skill_params.cjs
 */
const fs = require('fs');
const path = require('path');

const JSON_PATH = path.resolve(__dirname, '..', 'public', 'config', 'cards', 'cards_all.json');

// 每张卡的 params 映射，基于用户确认的技能效果
const PARAMS_MAP = {
  // ========== 6 主角 battle_card ==========
  hero_tangsan: { reward: 7 },            // 塘散·清心悟道：放回换 7 灵石
  hero_xiaowu:  { count: 2 },             // 小舞儿·妖力共鸣：抽 2 选 1
  hero_xiaoyan: { extraCost: 5 },         // 萧焱·焚决吞噬：额外 5 灵石多抽 1 张
  hero_xuner:   { reduce: 2 },            // 薰儿·金帝焚天诀：抽卡费用 -2
  hero_hanli:   { reward: 3 },            // 寒立·灵药储备：跳过得 3 灵石
  hero_wanglin: { extraCost: 3 },         // 旺林·天运窃取：额外 3 灵石必抽最高稀有度

  // ========== 24 R 卡 ==========
  r_liuerlong:   { rerollRarity: 'N' },          // 柳二龙·龙吟震慑：抽 N 可重抽
  r_dugubo:      { count: 2 },                   // 独孤博·毒手药王：抽 2 选 1
  r_beibei:      { count: 3 },                   // 贝贝·蓝电霸王龙感知：抽 3 选 1
  r_xusanshi:    { reduce: 2 },                  // 徐三石·玄武盾护：抽卡费用 -2
  r_zhaowuji:    { targetType: '法修', reward: 5 }, // 赵无极·暗金恐爪：法修 +5 灵石
  r_fulande:     { ip: '斗罗大陆' },             // 弗兰德·院长统筹：同 IP 优先
  r_qinglin:     { count: 3 },                   // 青鳞·三花瞳变：抽 3 选 1
  r_xiaoxiao:    { count: 2 },                   // 萧潇·踏空而行：抽 2 选 1
  r_ruolin:      { reward: 2 },                  // 若琳·银宗暗报：跳过得 2 灵石
  r_fama:        { ip: '斗破苍穹' },             // 法犸·炼药鉴定：同 IP 优先
  r_haibodong:   { rerollRarity: 'N' },          // 海波东·冰皇领域：抽 N 可重抽
  r_linxiuya:    { reduce: 2 },                  // 林修涯·风雷阁弟子：抽卡费用 -2
  r_xinruyin:    { targetType: '剑修', reward: 5 }, // 辛如音·琴剑双修：剑修 +5 灵石
  r_manhuzi:     { extraCost: 20 },              // 蛮胡子·蛮力开路：20 灵石指定抽
  r_dongxuaner:  { reduce: 2 },                  // 董萱儿·灵药妙解：抽卡费用 -2
  r_wangchan:    { gender: '女' },               // 王蝉·夏日の蝉：优先女性
  r_lihuayuan:   { ip: '凡人修仙传' },           // 李化元·炼丹妙手：同 IP 优先
  r_songyu:      {},                             // 宋玉·吹茶仙子：免灵石抽 1 次
  r_wangzhuo:    { extraCost: 6 },               // 王卓·王族血脉：额外 6 灵石多抽 1
  r_meiji:       { gender: '男' },               // 魅姬·魅惑之术：优先男性
  r_jimolaoren:  { targetType: '灵修', reward: 5 }, // 即墨老人·画道入修：灵修 +5 灵石
  r_suntai:      { extraCost: 6 },               // 孙泰·七星剑意：额外 6 灵石多抽 1
  r_zhouru:      { ip: '仙逆' },                 // 周茹·灵力探查：同 IP 优先
  r_duntian:     { threshold: 3, reward: 20 },   // 遁天·天使投资：累计 3 次得 20 灵石
};

const raw = fs.readFileSync(JSON_PATH, 'utf-8');
const data = JSON.parse(raw);

let patched = 0;

// 处理主角卡 battle_card.run_skill
(data.heroes || []).forEach((h) => {
  const params = PARAMS_MAP[h.id];
  if (!params) return;
  const skill = h.battle_card && h.battle_card.skills && h.battle_card.skills.run_skill;
  if (!skill) return;
  skill.params = params;
  patched++;
  console.log(`  ✓ hero[${h.id}] ${h.name} · ${skill.name}: ${JSON.stringify(params)}`);
});

// 处理 pool_r 的 run_skill
(data.pool_r || []).forEach((c) => {
  const params = PARAMS_MAP[c.id];
  if (!params) return;
  const skill = c.skills && c.skills.run_skill;
  if (!skill) return;
  skill.params = params;
  patched++;
  console.log(`  ✓ R[${c.id}] ${c.name} · ${skill.name}: ${JSON.stringify(params)}`);
});

// 写回 JSON（保留 2 空格缩进）
fs.writeFileSync(JSON_PATH, JSON.stringify(data, null, 2) + '\n', 'utf-8');
console.log(`\n✔ 已为 ${patched} 张卡的 run_skill 补齐 params 参数`);
