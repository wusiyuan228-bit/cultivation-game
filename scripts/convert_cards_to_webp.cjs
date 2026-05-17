/**
 * 将 public/images/cards/  和  public/images/cards_full/  下的 .jpg
 * 批量转码为同名 .webp（保留原 jpg 作为兜底）
 *
 * 使用方法：
 *   node scripts/convert_cards_to_webp.cjs            # 转两个目录
 *   node scripts/convert_cards_to_webp.cjs full       # 仅转 cards_full
 *   node scripts/convert_cards_to_webp.cjs small      # 仅转 cards
 *
 * 配置：
 *   FULL_QUALITY  = 80   翻面大图 quality（视觉无损上限附近）
 *   SMALL_QUALITY = 82   头像小图 quality
 *   EFFORT        = 6    [0~6] 6 = 最高压缩比，速度更慢；适合一次性脚本
 *
 * 设计原则：
 *   - 幂等：已存在 webp 且源 jpg 没更新时跳过（用 mtime 判断）
 *   - 不删除任何 jpg —— 浏览器若不支持 webp 仍可走 jpg
 *   - 输出统计：原大小、新大小、压缩率
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..', 'public', 'images');
const TARGETS = {
  full: { dir: path.join(ROOT, 'cards_full'), quality: 80 },
  small: { dir: path.join(ROOT, 'cards'), quality: 82 },
};
const EFFORT = 6;

const arg = process.argv[2];
const tasks = arg
  ? [TARGETS[arg]].filter(Boolean)
  : Object.values(TARGETS);

if (tasks.length === 0) {
  console.error(`Unknown arg: ${arg}. Use: full | small | (empty=all)`);
  process.exit(1);
}

(async () => {
  let totalOldBytes = 0;
  let totalNewBytes = 0;
  let totalConverted = 0;
  let totalSkipped = 0;

  for (const { dir, quality } of tasks) {
    if (!fs.existsSync(dir)) {
      console.warn(`[skip] dir not found: ${dir}`);
      continue;
    }

    const files = fs.readdirSync(dir).filter((f) => /\.jpe?g$/i.test(f));
    console.log(`\n=== ${path.relative(ROOT, dir)} (${files.length} jpgs, q=${quality}) ===`);

    for (const f of files) {
      const jpgPath = path.join(dir, f);
      const webpPath = path.join(dir, f.replace(/\.jpe?g$/i, '.webp'));

      const jpgStat = fs.statSync(jpgPath);
      // 幂等检查：webp 已存在且不老于 jpg → 跳过
      if (fs.existsSync(webpPath)) {
        const webpStat = fs.statSync(webpPath);
        if (webpStat.mtimeMs >= jpgStat.mtimeMs) {
          totalSkipped++;
          continue;
        }
      }

      try {
        await sharp(jpgPath)
          .webp({ quality, effort: EFFORT, smartSubsample: true })
          .toFile(webpPath);
        const webpStat = fs.statSync(webpPath);
        totalOldBytes += jpgStat.size;
        totalNewBytes += webpStat.size;
        totalConverted++;
        const ratio = ((1 - webpStat.size / jpgStat.size) * 100).toFixed(1);
        console.log(
          `  ✓ ${f.padEnd(36)} ${(jpgStat.size / 1024).toFixed(0).padStart(4)}KB → ${(webpStat.size / 1024).toFixed(0).padStart(4)}KB  (-${ratio}%)`
        );
      } catch (err) {
        console.error(`  ✗ ${f}  FAILED: ${err.message}`);
      }
    }
  }

  console.log('\n========== Summary ==========');
  console.log(`Converted: ${totalConverted}   Skipped(up-to-date): ${totalSkipped}`);
  if (totalConverted > 0) {
    console.log(
      `Total size:  ${(totalOldBytes / 1024 / 1024).toFixed(2)}MB → ${(totalNewBytes / 1024 / 1024).toFixed(2)}MB  ` +
      `(-${((1 - totalNewBytes / totalOldBytes) * 100).toFixed(1)}%, saved ${((totalOldBytes - totalNewBytes) / 1024 / 1024).toFixed(2)}MB)`
    );
  }
})();
