import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react-swc'
import { defineConfig } from 'vite'

/**
 * 构建配置说明：
 *   - 认证与数据接口改由同源 Worker 提供（/api/*），前端不再需要构建期注入云服务凭据，
 *     因此移除了原 CloudBase 的 define 注入逻辑与 OAUTH_RELAY_URL 中继依赖。
 *   - 开发态把 /api 代理到后端（默认服务器 https://47.106.222.26），
 *     保证前后端同源、Cookie 可用。
 *
 * 服务器地址的覆盖方式（默认值为服务器地址，本地开发时用环境变量切回本机）：
 *   WORKER_DEV_ORIGIN=http://127.0.0.1:8787 pnpm dev    # 本地 wrangler dev
 *   pnpm dev                                            # 服务器
 */
const WORKER_DEV_ORIGIN = process.env.WORKER_DEV_ORIGIN || 'https://47.106.222.26'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-motion': ['framer-motion'],
          'vendor-markdown': ['react-markdown', 'remark-gfm'],
        },
      },
    },
  },
  server: {
    host: '::',
    port: 5173,
    allowedHosts: true,
    cors: true,
    proxy: {
      '/api': {
        target: WORKER_DEV_ORIGIN,
        // 代理到服务器时必须改写 Host：反向代理按 vhost 分发，
        // 若继续发送 Host: localhost:5173 会被服务端判为未知站点而返回 404。
        // 对本地 wrangler dev 无影响（它不按 Host 分发）。
        changeOrigin: true,
        // 允许自签名证书（服务器若用自签证书，本地代理不会因此报错）
        secure: false,
        ws: true,
      },
    },
  },
})
