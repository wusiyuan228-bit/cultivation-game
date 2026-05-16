/**
 * postbuild.cjs
 * --------------------------------------
 * Vite 构建后处理脚本
 *
 * 作用：
 *   1. 把 dist/ 中 CSS/JS/HTML 里残留的绝对路径 "/images/xxx" 
 *      转换成带 base 前缀的 "/cultivation-game/images/xxx"
 *
 * 为什么需要：
 *   Vite 的 base 配置只会重写通过 JS 的 import.meta.env.BASE_URL 拼接出来的路径、
 *   以及 CSS 里通过 @/ 别名或 asset import 引入的资源；
 *   但对 CSS 里的 url('/xxx') 这种"自以为是绝对路径"的写法不会处理。
 *   我们的项目历史原因有多处直接写 url('/images/xxx.jpg')，因此需要后处理。
 *
 * 执行方式：npm run build 后自动触发（见 package.json scripts.build）
 */

const fs = require('fs');
const path = require('path');

const DIST = path.resolve(__dirname, '..', 'dist');
// 与 vite.config.ts 保持一致的 base 决策逻辑
//  - DEPLOY_TARGET=edgeone   → '/'        （腾讯云 EdgeOne Pages，根路径）
//  - 其他（默认 GitHub Pages）→ '/cultivation-game/'
const DEPLOY_TARGET = process.env.DEPLOY_TARGET || 'github';
const BASE = DEPLOY_TARGET === 'edgeone' ? '/' : '/cultivation-game/';

// 如果 BASE 已经是 '/'，那么没什么要改写的（资源本来就是 /images/xxx），直接跳过
const SKIP = BASE === '/';

// 要处理的文件扩展名
const EXTS = ['.css', '.js', '.html'];

// 在这些路径前缀下的引用才需要被加上 base
// （避免错改 URL 中的 /images/ 这种出现在其他语义的字符串）
const TARGETS = ['images', 'fonts', 'audio', 'config'];

function walk(dir) {
    const out = [];
    for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
            out.push(...walk(full));
        } else if (EXTS.includes(path.extname(name))) {
            out.push(full);
        }
    }
    return out;
}

function processFile(file) {
    let content = fs.readFileSync(file, 'utf8');
    let changed = false;

    for (const t of TARGETS) {
        // 匹配 url(/images/xxx) url('/images/xxx') url("/images/xxx")
        // 以及 "/images/xxx" '/images/xxx' （不含 url()）
        // 但不要匹配 //images（协议相对 URL）或 /cultivation-game/images（已有 base）
        const re = new RegExp(
            // 前面不能是 /（排除 //）或 cultivation-game（排除已处理）
            '(?<!/)(?<!cultivation-game)(["\\\'(])/(' + t + '/)',
            'g'
        );
        const before = content;
        content = content.replace(re, `$1${BASE}$2`);
        if (content !== before) changed = true;
    }

    if (changed) {
        fs.writeFileSync(file, content, 'utf8');
        console.log('[postbuild] fixed:', path.relative(DIST, file));
        return 1;
    }
    return 0;
}

if (!fs.existsSync(DIST)) {
    console.error('[postbuild] dist/ not found, skip');
    process.exit(0);
}

if (SKIP) {
    console.log(`[postbuild] BASE='/' (DEPLOY_TARGET=${DEPLOY_TARGET})，无需重写资源路径，跳过。`);
    process.exit(0);
}

const files = walk(DIST);
let fixedCount = 0;
for (const f of files) {
    fixedCount += processFile(f);
}

console.log(`\n[postbuild] Done. ${fixedCount}/${files.length} files fixed. BASE="${BASE}"`);
