/**
 * 一次性批量改名脚本：把所有非主角卡牌 name 改为同音字，
 * 同时同步 desc 和代码里所有"会显示给玩家"的字符串。
 *
 * 执行：node scripts/rename_apply.cjs
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// ============================================================
// 命名映射表（旧名 → 新名）
// 规则：保持发音相近，不增字不减字
// ============================================================
const NAME_MAP = {
  // pool_n（凡人）
  '泰隆': '泰珑',
  '江楠楠': '江南南',
  '许小言': '徐小焉',
  '凤清儿': '凤青儿',
  '萧鼎': '肖顶',
  '格娜': '戈娜',
  '张铁': '章铁',
  '梅凝': '莓凝',
  '墨居仁': '墨菊仁',
  '张虎': '章虎',
  '大牛': '达牛',
  '藤厉': '腾沥',

  // pool_r
  '柳二龙': '刘二陇',
  '独孤博': '独孤搏',
  '贝贝': '卑卑',
  '徐三石': '徐叁石',
  '赵无极': '召无极',
  '弗兰德': '福兰德',
  '青鳞': '清麟',
  '萧潇': '肖筱',
  '若琳': '偌琳',
  '法犸': '法蟆',
  '海波东': '海勃东',
  '林修涯': '林秀崖',
  '辛如音': '辛如茵',
  '蛮胡子': '蛮虎髭',
  '董萱儿': '董轩儿',
  '王蝉': '汪蝉',
  '李化元': '黎华元',
  '宋玉': '颂玉',
  '王卓': '旺卓',
  '魅姬': '媚姬',
  '即墨老人': '季墨老人',
  '孙泰': '孙太',
  '周茹': '邹儒',
  '遁天': '顿天',

  // pool_sr
  '戴沐白': '岱牧百',
  '朱竹清': '朱苎青',
  '宁荣荣': '凝蓉蓉',
  '千仞雪': '千刃雪',
  '奥斯卡': '傲思卡',
  '马红俊': '马洪骏',
  '纳兰嫣然': '纳兰艳然',
  '风闲': '风娴',
  '古河': '顾河',
  '天火尊者': '添火尊者',
  '雅妃': '娅妃',
  '紫妍': '子妍',
  '厉飞雨': '立飞羽',
  '菡云芝': '涵云芝',
  '慕沛灵': '暮佩翎',
  '陈巧倩': '沉俏茜',
  '元瑶': '缘瑶',
  '冰凤': '冰凰',
  '红蝶': '鸿蝶',
  '柳眉': '留眉',
  '藤化原': '腾华原',
  '云雀子': '云鹊子',
  '许立国': '徐立国',
  '王平': '旺平',

  // pool_ssr
  '比比东': '碧碧栋',
  '霍雨浩': '霍宇皓',
  '宁风致': '凝丰志',
  '美杜莎': '玫渡纱',
  '云韵': '雲蕴',
  '萧玄': '肖璇',
  '玄骨': '玄古',
  '墨彩环': '墨采寰',
  '紫灵': '子绫',
  '周佚': '邹翼',
  '拓森': '沱森',
  '天运子': '天蕴子',

  // bind_ssr / bind_sr
  '二明': '尔铭',
  '药尘': '曜尘',
  '古元': '顾元',
  '南宫婉': '南宫宛',
  '司徒南': '司图楠',
  '唐雅': '塘雅',
  '王冬儿': '汪冬儿',
  '萧战': '霄战',
  '小医仙': '小忆仙',
  '银月': '隐月',
  '李慕婉': '黎慕婉',

  // 主角原型名（出现在描述里时也要替换为游戏内主角名）
  '唐三': '塘散',
  '小舞': '小舞儿',  // 注意：'小舞儿'本身含'小舞'，需要先替换'小舞儿'再替换'小舞'？不，'小舞'→'小舞儿'是反向。这里不能简单替换。需要单独处理。
  '萧炎': '萧焱',
  '韩立': '寒立',
  '王林': '旺林',
};

// 注意：'小舞' → '小舞儿' 会导致 '小舞儿' 变成 '小舞儿儿'。需要特殊处理：
// 先处理"小舞儿"为占位符，再处理"小舞"，最后还原。
// 同理 '萧玄' (ssr) 与 '萧族'（不在 map 中）是不同的概念，但 '萧'字有歧义，需要谨慎。
// 萧玄→肖璇：直接全文替换'萧玄'是安全的（不会误伤'萧族'/'萧焱'）。
// 萧炎→萧焱：原作'萧炎'是炎，主角'萧焱'是焱，全文替换'萧炎'到'萧焱'安全（'萧焱'本身不含'萧炎'）。
// 萧潇→肖筱：'萧潇'→'肖筱'，但需要先替换'萧潇'，再替换'萧'……不，不存在通配'萧'的替换。OK。
// 萧鼎→肖顶：'萧鼎'→'肖顶'，OK。
// 萧战→霄战：'萧战'→'霄战'，但要小心'萧战'是bsr卡的name，OK。
// 萧族（设定）：未做替换。

// ============================================================
// 安全替换：用占位符避免连锁替换冲突
// ============================================================
// 保留词：这些词不会被替换（占位保护）
// 例如：'小舞儿' 是主角新名，里面含'小舞'，但'小舞'要被替换为'小舞儿'，
//      若不保护'小舞儿'，会变成'小舞儿儿'。
const RESERVED_WORDS = [
  '小舞儿',  // 主角新名
  '萧焱',    // 主角新名（避免被'萧炎→萧焱'再次匹配 / 被某些子串误伤）
  '寒立',    // 主角新名
  '旺林',    // 主角新名
  '塘散',    // 主角新名（与'唐三'映射）
  '薰儿',    // 主角名（不变，但含可能的字符冲突时保护）
];

function safeReplaceAll(text, fromList) {
  let work = text;
  const placeholders = [];

  // Step 0: 先把"保留词"换成占位符（防止后续替换破坏它们）
  RESERVED_WORDS.forEach((rw, i) => {
    const ph = `\u{F1000}${i}\u{F1001}`;
    while (work.includes(rw)) {
      work = work.replace(rw, ph);
    }
    placeholders.push([ph, rw]);  // 还原回原词
  });

  // Step 1: 把所有"长名"先替换成占位符（避免短名先替换破坏长名）
  // fromList 已经按长度降序排列
  for (let i = 0; i < fromList.length; i++) {
    const [oldName, newName] = fromList[i];
    if (!oldName || !newName) continue;
    const ph = `\u{F0000}${i}\u{F0001}`;
    while (work.includes(oldName)) {
      work = work.replace(oldName, ph);
    }
    placeholders.push([ph, newName]);
  }

  // Step 2: 把占位符还原（保留词→保留词；旧名占位→新名）
  for (const [ph, finalText] of placeholders) {
    while (work.includes(ph)) {
      work = work.replace(ph, finalText);
    }
  }
  return work;
}

// 按长度降序排列（确保长名先替换）
const sortedMap = Object.entries(NAME_MAP)
  .filter(([k, v]) => k && v && k !== v)
  .sort(([a], [b]) => b.length - a.length);

// ============================================================
// 1) 改写 cards_all.json
// ============================================================
function rewriteCardsJson() {
  const filePath = path.join(ROOT, 'public/config/cards/cards_all.json');
  const raw = fs.readFileSync(filePath, 'utf-8');
  const data = JSON.parse(raw);
  const pools = ['pool_n', 'pool_r', 'pool_sr', 'pool_ssr', 'bind_ssr', 'bind_sr'];
  let changedNames = 0;
  let changedDescs = 0;
  let changedSkillNames = 0;

  for (const k of pools) {
    if (!Array.isArray(data[k])) continue;
    for (const c of data[k]) {
      // 改 name
      if (c.name && NAME_MAP[c.name]) {
        c.name = NAME_MAP[c.name];
        changedNames++;
      }
      // tribute 不动（保留作内部致敬记录）
      // 改技能 desc 和 name
      const sk = c.skills || {};
      for (const slot of ['battle_skill', 'ultimate', 'run_skill']) {
        const s = sk[slot];
        if (!s) continue;
        if (typeof s.desc === 'string') {
          const newDesc = safeReplaceAll(s.desc, sortedMap);
          if (newDesc !== s.desc) {
            s.desc = newDesc;
            changedDescs++;
          }
        }
        if (typeof s.name === 'string') {
          const newName = safeReplaceAll(s.name, sortedMap);
          if (newName !== s.name) {
            s.name = newName;
            changedSkillNames++;
          }
        }
      }
    }
  }

  // 写回（保持原格式：2 空格缩进）
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`[cards_all.json] 卡牌name改了 ${changedNames} 个，技能desc改了 ${changedDescs} 个，技能name改了 ${changedSkillNames} 个`);
}

// ============================================================
// 2) 改写若干 ts/tsx 文件中的"会显示给玩家"字符串
// ============================================================
const TEXT_FILES_TO_REWRITE = [
  'src/screens/S4_StoryReading.tsx',
  'src/data/s8NegotiationData.ts',
  'src/data/awakeningTriggers.ts',
  'src/data/heroesData.ts',
  'src/data/heroBlueprints.ts',
];

// 同时扫描 src/systems/battle/skills/ 下所有 .ts 文件
function listSkillFiles() {
  const dir = path.join(ROOT, 'src/systems/battle/skills');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => `src/systems/battle/skills/${f}`);
}

function rewriteTextFile(relPath) {
  const filePath = path.join(ROOT, relPath);
  if (!fs.existsSync(filePath)) {
    console.log(`  [跳过] 文件不存在：${relPath}`);
    return false;
  }
  const before = fs.readFileSync(filePath, 'utf-8');
  const after = safeReplaceAll(before, sortedMap);
  if (after !== before) {
    fs.writeFileSync(filePath, after, 'utf-8');
    // 统计差异行
    const beforeLines = before.split('\n');
    const afterLines = after.split('\n');
    let diff = 0;
    for (let i = 0; i < Math.min(beforeLines.length, afterLines.length); i++) {
      if (beforeLines[i] !== afterLines[i]) diff++;
    }
    console.log(`  [改] ${relPath}（${diff} 行改动）`);
    return true;
  }
  return false;
}

function rewriteAllTextFiles() {
  const all = [...TEXT_FILES_TO_REWRITE, ...listSkillFiles()];
  let n = 0;
  for (const p of all) {
    if (rewriteTextFile(p)) n++;
  }
  console.log(`[ts/tsx] 共改写 ${n} 个文件`);
}

// ============================================================
// 主流程
// ============================================================
console.log('━━━━━━━━━━━━━━ 开始批量改名 ━━━━━━━━━━━━━━');
console.log(`映射表条目数: ${sortedMap.length}`);
rewriteCardsJson();
rewriteAllTextFiles();
console.log('━━━━━━━━━━━━━━ 完成 ━━━━━━━━━━━━━━');
