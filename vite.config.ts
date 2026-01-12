// vite.config.ts
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      base: './',
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      define: {
        // [修改] 移除 API_KEY 定義，確保金鑰不會出現在前端 JS 檔案中
        'process.env.GEMINI_MODEL': JSON.stringify(env.GEMINI_MODEL || "gemini-1.5-flash")
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});