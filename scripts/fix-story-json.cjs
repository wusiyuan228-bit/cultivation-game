/**
 * 一次性修复 / 校验脚本：剥离剧情 JSON 中的 BOM + 转义字符串内的裸控制字符。
 *
 * 背景（2026-05-14）：
 *   - PowerShell 的 ConvertFrom-Json 容忍 BOM 和字符串内裸 \r\n\t —— 本地校验通过
 *   - 浏览器 / Node 严格按 RFC 8259 → JSON.parse 抛 SyntaxError
 *   - 上次替换剧本时部分文件被编辑器写入了非法字符，导致萧焱 ch4 等加载失败
 *
 * 用法：node scripts/fix-story-json.cjs
 */
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'public', 'config', 'story');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));

let fixed = 0;
let bomStripped = 0;
let stillBad = 0;

for (const f of files) {
  const full = path.join(dir, f);
  let txt = fs.readFileSync(full, 'utf8');

  // 1) 剥离 BOM
  let bomChanged = false;
  if (txt.charCodeAt(0) === 0xfeff) {
    txt = txt.slice(1);
    bomChanged = true;
    bomStripped++;
  }

  // 2) 扫描字符串内的裸控制字符并转义（状态机）
  let out = '';
  let inString = false;
  let escaped = false;
  let charChanged = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (escaped) {
      out += c;
      escaped = false;
      continue;
    }
    if (inString && c === '\\') {
      out += c;
      escaped = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      out += c;
      continue;
    }
    if (inString) {
      if (c === '\n') { out += '\\n'; charChanged = true; continue; }
      if (c === '\r') { out += '\\r'; charChanged = true; continue; }
      if (c === '\t') { out += '\\t'; charChanged = true; continue; }
    }
    out += c;
  }

  if (bomChanged || charChanged) {
    // 修复后必须能解析
    try {
      JSON.parse(out);
      fs.writeFileSync(full, out, 'utf8');
      const tags = [];
      if (bomChanged) tags.push('BOM');
      if (charChanged) tags.push('CTRL');
      console.log(`✅ FIXED [${tags.join('+')}]: ${f}`);
      fixed++;
    } catch (e) {
      console.log(`❌ POST-FIX STILL BAD: ${f} -> ${e.message}`);
      stillBad++;
    }
  } else {
    // 也最终校验一遍，没改的文件也得保证合法
    try {
      JSON.parse(txt);
    } catch (e) {
      console.log(`⚠️  UNCHANGED BUT INVALID: ${f} -> ${e.message}`);
      stillBad++;
    }
  }
}

console.log('---');
console.log(`Total: ${files.length}, Fixed: ${fixed}, BOM stripped: ${bomStripped}, Still bad: ${stillBad}`);
process.exit(stillBad > 0 ? 1 : 0);
