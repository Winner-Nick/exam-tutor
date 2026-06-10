import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // 开发时代理到本地后端，保持同源（cookie 鉴权直接生效）
      '/api': 'http://127.0.0.1:8080',
    },
  },
  build: {
    chunkSizeWarningLimit: 800,
  },
})
