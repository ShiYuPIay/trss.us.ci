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

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  define: {
    'import.meta.env.VITE_CLOUDBASE_ENV_ID': JSON.stringify(tcbEnv.CLOUDBASE_ENV_ID || ''),
    'import.meta.env.VITE_CLOUDBASE_REGION': JSON.stringify(tcbEnv.CLOUDBASE_REGION || 'ap-shanghai'),
    'import.meta.env.VITE_CLOUDBASE_PUBLISH_KEY': JSON.stringify(tcbEnv.CLOUDBASE_PUBLISH_KEY || ''),
    'import.meta.env.VITE_OAUTH_RELAY_URL': JSON.stringify(process.env.OAUTH_RELAY_URL || ''),
  },
  server: {
    host: '::', port: 5173, allowedHosts: true, cors: true,
    hmr: { protocol: 'wss', host: `5173-${process.env.X_IDE_SPACE_KEY}.e2b.${process.env.X_IDE_SPACE_REGION}.${process.env.X_IDE_SPACE_HOST}` },
    proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: true, secure: false, ws: true } },
  },
})
