import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ConnectionInput } from '../../../src/shared/types'
import { createWebServer } from '../../../src/web/server'
import { WebStore } from '../../../src/web/webStore'

const running: Array<ReturnType<typeof createWebServer>> = []

afterEach(async () => {
  await Promise.all(
    running
      .splice(0)
      .map(
        ({ server, closeSessions }) =>
          new Promise<void>((resolve) => server.close(() => void closeSessions().finally(resolve)))
      )
  )
})

describe('AMDM Web RPC', () => {
  it('requires the trusted origin and SSO identity and enforces user ownership', async () => {
    const root = mkdtempSync(join(tmpdir(), 'amdm-web-server-'))
    const staticDir = join(root, 'static')
    await import('node:fs/promises').then((fs) => fs.mkdir(staticDir))
    writeFileSync(join(staticDir, 'index.html'), '<div>AMDM</div>')
    const store = new WebStore(join(root, 'data'), Buffer.alloc(32, 5))
    const app = createWebServer({
      store,
      origin: 'https://amdm.test',
      staticDir
    })
    running.push(app)
    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve))
    const address = app.server.address()
    if (!address || typeof address === 'string') throw new Error('Server did not listen.')
    const url = `http://127.0.0.1:${address.port}/api/rpc`

    const call = (method: string, args: unknown[], user = 'alice', origin = 'https://amdm.test') =>
      fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin,
          ...(user ? { 'x-forwarded-user': user } : {})
        },
        body: JSON.stringify({ method, args })
      })

    const connection: ConnectionInput = {
      id: crypto.randomUUID(),
      name: 'Mongo',
      useSrv: false,
      host: 'localhost:27017',
      auth: { type: 'none' },
      ssh: { enabled: false },
      tls: { enabled: false }
    }
    const savedResponse = await call('connections.save', [connection])
    expect(savedResponse.status).toBe(200)
    const saved = (await savedResponse.json()) as { result: { id: string } }

    expect(await (await call('connections.list', [], 'bob')).json()).toMatchObject({ ok: true, result: [] })
    expect((await call('session.status', [saved.result.id], 'bob')).status).toBe(400)
    expect((await call('connections.list', [], '')).status).toBe(400)
    expect((await call('connections.list', [], 'alice', 'https://evil.test')).status).toBe(400)
    expect((await call('schemas.get', [{}])).status).toBe(400)
  })
})
