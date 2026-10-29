import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 5173,
    host: true,
    watch: {
      // 词频原始数据只在构建前跑脚本时用，别让文件监听去碰它
      ignored: ['**/tools/freq/**', '**/scripts/_probe*'],
    },
  },
  preview: {
    host: true,
    port: 4173,
    allowedHosts: true,
  },
  build: {
    target: 'es2019',
    chunkSizeWarningLimit: 2000,
  },
});
