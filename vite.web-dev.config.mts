import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, mergeConfig, type Plugin } from 'vite'
import webConfig from './vite.web.config.mts'
import { createWebRequestHandler } from './src/web/server'
import { WebStore } from './src/web/webStore'

function webBackend(): Plugin {
  return {
    name: 'amdm-web-backend',
    configureServer(viteServer) {
      const dataDir = resolve('.web-data')
      const keyPath = resolve(dataDir, 'master-key')
      mkdirSync(dataDir, { recursive: true, mode: 0o700 })
      if (!existsSync(keyPath)) writeFileSync(keyPath, randomBytes(32).toString('base64'), { mode: 0o600 })

      const app = createWebRequestHandler({
        store: new WebStore(dataDir, Buffer.from(readFileSync(keyPath, 'utf8').trim(), 'base64')),
        origin: 'http://127.0.0.1:5173',
        staticDir: resolve('out/web')
      })
      viteServer.middlewares.use((req, res, next) => {
        if (req.url !== '/healthz' && req.url !== '/api/rpc') return next()
        if (req.url === '/api/rpc') req.headers['x-forwarded-user'] = 'local-dev'
        void app.handle(req, res)
      })
      viteServer.httpServer?.once('close', () => void app.closeSessions())
    }
  }
}

export default defineConfig(
  mergeConfig(webConfig, {
    plugins: [webBackend()],
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true
    }
  })
)
