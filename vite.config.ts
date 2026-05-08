import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// GitHub Pages 部署路径：https://wusiyuan228-bit.github.io/cultivation-game/
// 开发模式下使用 '/'，生产构建使用 '/cultivation-game/'
const isProd = process.env.NODE_ENV === 'production';

export default defineConfig({
  base: isProd ? '/cultivation-game/' : '/',
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
