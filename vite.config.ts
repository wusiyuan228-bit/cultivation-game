import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 部署目标说明：
//  - 默认（GitHub Pages）：https://wusiyuan228-bit.github.io/cultivation-game/  → base = '/cultivation-game/'
//  - EdgeOne Pages（国内）：https://xianzhan.pages.eo.dev/                       → base = '/'
//  - 本地开发：base = '/'
// 通过环境变量 DEPLOY_TARGET 区分（在托管平台的"环境变量"里配置 DEPLOY_TARGET=edgeone 即可走根路径）。
const isProd = process.env.NODE_ENV === 'production';
const deployTarget = process.env.DEPLOY_TARGET ?? 'github';
const baseUrl = !isProd
  ? '/'
  : deployTarget === 'edgeone'
    ? '/'
    : '/cultivation-game/';

export default defineConfig({
  base: baseUrl,
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    open: true,
  },
});
