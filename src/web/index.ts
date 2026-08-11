import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createWebServer } from './server'
import { decodeMasterKey, WebStore } from './webStore'
import { serializerPool } from '../main/workers/serializerPool'

const originValue = process.env.AMDM_WEB_ORIGIN
if (!originValue) throw new Error('AMDM_WEB_ORIGIN is required, for example https://amdm.internal.example.')
const origin = new URL(originValue).origin

const host = process.env.AMDM_WEB_HOST ?? '127.0.0.1'
const port = Number(process.env.AMDM_WEB_PORT ?? 4173)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('AMDM_WEB_PORT is invalid.')

const here = dirname(fileURLToPath(import.meta.url))
const dataDirValue = process.env.AMDM_WEB_DATA_DIR
if (!dataDirValue) throw new Error('AMDM_WEB_DATA_DIR is required.')
const dataDir = resolve(dataDirValue)
const staticDir = resolve(process.env.AMDM_WEB_STATIC_DIR ?? resolve(here, '../web'))
const store = new WebStore(dataDir, decodeMasterKey(process.env.AMDM_WEB_MASTER_KEY))
const { server, closeSessions } = createWebServer({ store, origin, staticDir })

server.listen(port, host, () => console.log(`AMDM Web listening on http://${host}:${port}`))

const shutdown = (): void => {
  server.close(() => {
    void closeSessions().finally(() => {
      serializerPool.dispose()
      process.exit(0)
    })
  })
}
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
