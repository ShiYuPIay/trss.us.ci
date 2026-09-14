import fs from 'fs'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react-swc'
import { defineConfig } from 'vite'
import process from 'process'

const tcbEnvPath = '/workspace/.env.tcb'
const tcbEnv: Record<string, string> = {}
if (fs.existsSync(tcbEnvPath)) {
  fs.readFileSync(tcbEnvPath, 'utf-8').split('\n').forEach((line) => {
    const index = line.indexOf('=')
    if (index > 0) tcbEnv[line.slice(0, index).trim()] = line.slice(index + 1).trim()
  })
}

// Only build the IDE HMR host when all three variables exist, otherwise the
// template would interpolate to "5173-undefined.e2b.undefined.undefined".
const ideSpaceHost =
  process.env.X_IDE_SPACE_KEY && process.env.X_IDE_SPACE_REGION && process.env.X_IDE_SPACE_HOST
    ? `5173-${process.env.X_IDE_SPACE_KEY}.e2b.${process.env.X_IDE_SPACE_REGION}.${process.env.X_IDE_SPACE_HOST}`
    : undefined

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  define: {
    // Values are read from the IDE sandbox file first, then from real process
    // environment variables. Cloudflare Workers Builds has no
    // /workspace/.env.tcb, so without the process.env fallback the production
    // bundle would be compiled with empty CloudBase credentials and the app
    // would silently run unconfigured (isCloudConfigured === false).
    'import.meta.env.VITE_CLOUDBASE_ENV_ID': JSON.stringify(
      tcbEnv.CLOUDBASE_ENV_ID || process.env.VITE_CLOUDBASE_ENV_ID || process.env.CLOUDBASE_ENV_ID || '',
    ),
    'import.meta.env.VITE_CLOUDBASE_REGION': JSON.stringify(
      tcbEnv.CLOUDBASE_REGION || process.env.VITE_CLOUDBASE_REGION || process.env.CLOUDBASE_REGION || 'ap-shanghai',
    ),
    'import.meta.env.VITE_CLOUDBASE_PUBLISH_KEY': JSON.stringify(
      tcbEnv.CLOUDBASE_PUBLISH_KEY || process.env.VITE_CLOUDBASE_PUBLISH_KEY || process.env.CLOUDBASE_PUBLISH_KEY || '',
    ),
    'import.meta.env.VITE_OAUTH_RELAY_URL': JSON.stringify(
      process.env.VITE_OAUTH_RELAY_URL || process.env.OAUTH_RELAY_URL || '',
    ),
  },
  build: {
    // @cloudbase/js-sdk ships as a single ~770 kB bundle that cannot be split any
    // further, so the default 500 kB threshold would warn on every build. Vendor
    // code is split below and the ceiling is raised just above the largest chunk.
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-motion': ['framer-motion'],
          'vendor-cloudbase': ['@cloudbase/js-sdk'],
          'vendor-markdown': ['react-markdown', 'remark-gfm'],
        },
      },
    },
  },
  server: {
    host: '::', port: 5173, allowedHosts: true, cors: true,
    ...(ideSpaceHost ? { hmr: { protocol: 'wss' as const, host: ideSpaceHost } } : {}),
    proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: true, secure: false, ws: true } },
  },
})
