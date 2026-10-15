import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { brotliCompressSync, gzipSync } from 'node:zlib'
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
  it('negotiates precompressed static files, preserves MIME/cache headers, and supports HEAD', async () => {
    const root = mkdtempSync(join(tmpdir(), 'amdm-web-compression-'))
    const content = 'export const message = "AMDM";\n'.repeat(100)
    const gzip = gzipSync(content)
    const brotli = brotliCompressSync(content)
    writeFileSync(join(root, 'app.js'), content)
    writeFileSync(join(root, 'app.js.gz'), gzip)
    writeFileSync(join(root, 'app.js.br'), brotli)
    writeFileSync(join(root, 'index.html'), '<div>AMDM</div>')
    const app = createWebServer({
      store: new WebStore(join(root, 'data'), Buffer.alloc(32, 5)),
      origin: 'https://amdm.test',
      staticDir: root
    })
    running.push(app)
    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve))
    const address = app.server.address()
    if (!address || typeof address === 'string') throw new Error('Server did not listen.')
    const url = `http://127.0.0.1:${address.port}`
    const cases = [
      ['br, gzip', 'br', brotli.length],
      ['gzip', 'gzip', gzip.length],
      ['br;q=0.5, gzip;q=1', 'gzip', gzip.length],
      ['br;q=0, gzip', 'gzip', gzip.length],
      ['gzip ; q=1, br;q=0', 'gzip', gzip.length],
      ['*;q=1, br;q=0', 'gzip', gzip.length],
      ['identity', null, Buffer.byteLength(content)],
      ['br;q=0, gzip;q=0', null, Buffer.byteLength(content)],
      ['br;q=0.5, identity;q=1', null, Buffer.byteLength(content)]
    ] as const
    for (const [accepted, encoding, length] of cases) {
      const headers = { 'accept-encoding': accepted }
      const response = await fetch(`${url}/app.js`, { headers })
      expect(response.status, accepted).toBe(200)
      expect(response.headers.get('content-encoding'), accepted).toBe(encoding)
      expect(response.headers.get('content-length'), accepted).toBe(String(length))
      expect(response.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
      expect(response.headers.get('vary')).toBe('Accept-Encoding')
      expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
      expect(await response.text()).toBe(content)
      const head = await fetch(`${url}/app.js`, { method: 'HEAD', headers })
      expect(head.headers.get('content-encoding')).toBe(encoding)
      expect(head.headers.get('content-length')).toBe(String(length))
      expect(await head.text()).toBe('')
    }
    const html = await fetch(url, { headers: { 'accept-encoding': 'br, gzip' } })
    expect(html.headers.get('content-encoding')).toBeNull()
    expect(html.headers.get('cache-control')).toBe('no-cache')
    expect(await html.text()).toBe('<div>AMDM</div>')
    const unacceptable = await fetch(`${url}/app.js`, { headers: { 'accept-encoding': '*;q=0' } })
    expect(unacceptable.status).toBe(406)
  })

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
        body: JSON.stringify({ method, args, clientId: '00000000-0000-4000-8000-000000000001', storageMode: 'server' })
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
