/**
 * 资产路径工具
 * --------------------------------
 * 适配 GitHub Pages 等子路径部署（如 https://xxx.github.io/cultivation-game/）。
 *
 * Vite 会把 vite.config.ts 的 `base` 注入到 `import.meta.env.BASE_URL`：
 *   - 开发模式: '/'
 *   - 生产模式: '/cultivation-game/'
 *
 * 使用方式：
 *   - JS/TS 里凡是原本写 '/images/xxx.jpg' 的地方，改为 asset('images/xxx.jpg')
 *   - 仍然兼容传入以 '/' 开头的旧路径：asset('/images/xxx.jpg')
 *   - CSS 里无法用本函数，改用相对路径或 CSS 变量（见 fonts.css/global.css）
 */

const BASE = import.meta.env.BASE_URL; // '/' 或 '/cultivation-game/'

/**
 * 将一个 public/ 目录下的资源相对路径转换为带 base 前缀的完整 URL 路径。
 *
 * @param p  路径（可带或不带开头 '/'）
 * @returns  '/cultivation-game/images/xxx.jpg' 之类的完整路径
 */
export function asset(p: string): string {
  if (!p) return BASE;
  // 已经是完整 http(s) URL 或 data URI / blob URI，原样返回
  if (/^(https?:)?\/\//.test(p) || /^(data|blob):/.test(p)) return p;
  // 去掉开头可能的 '/'
  const clean = p.replace(/^\/+/, '');
  // BASE 一定以 '/' 结尾（Vite 保证），直接拼接
  return BASE + clean;
}

/** 便捷别名 */
export const assetUrl = asset;
