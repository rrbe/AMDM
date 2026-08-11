import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ConnectionInput, ShellResult } from '../../src/shared/types'
import { createWebServer } from '../../src/web/server'
import { WebStore } from '../../src/web/webStore'
import { startMongo, type MongoHarness } from '../helpers/mongo'

let mongo: MongoHarness
let app: ReturnType<typeof createWebServer>
let rpcUrl = ''

beforeAll(async () => {
  mongo = await startMongo()
  const root = mkdtempSync(join(tmpdir(), 'amdm-web-integration-'))
  const staticDir = join(root, 'static')
  mkdirSync(staticDir)
  writeFileSync(join(staticDir, 'index.html'), '<div>AMDM</div>')
  app = createWebServer({
    store: new WebStore(join(root, 'data'), Buffer.alloc(32, 9)),
    origin: 'https://amdm.test',
    staticDir
  })
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve))
  const address = app.server.address()
  if (!address || typeof address === 'string') throw new Error('Web server did not listen.')
  rpcUrl = `http://127.0.0.1:${address.port}/api/rpc`
}, 120_000)

afterAll(async () => {
  await new Promise<void>((resolve) => app?.server.close(resolve))
  await app?.closeSessions()
  await mongo?.stop()
})

async function rpc<T>(method: string, ...args: unknown[]): Promise<T> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://amdm.test',
      'x-forwarded-user': 'alice@example.com'
    },
    body: JSON.stringify({ method, args })
  })
  const body = (await response.json()) as { ok: boolean; result: T; error?: string }
  if (!body.ok) throw new Error(body.error)
  return body.result
}

describe('AMDM Web against MongoDB', () => {
  it('connects, queries, cancels ownership keys, and mutates one document through RPC', async () => {
    const connection: ConnectionInput = {
      id: crypto.randomUUID(),
      name: 'Test Mongo',
      useSrv: false,
      host: new URL(mongo.server.getUri()).host,
      auth: { type: 'none' },
      ssh: { enabled: false },
      tls: { enabled: false }
    }
    await rpc('connections.save', connection)
    expect(await rpc('session.connect', connection.id)).toMatchObject({ id: connection.id, state: 'connected' })

    await mongo.client.db('webtest').collection('items').insertOne({ name: 'first', count: 1 })
    expect(await rpc('catalog.collections', connection.id, 'webtest')).toMatchObject([
      { name: 'items', type: 'collection' }
    ])

    const result = await rpc<ShellResult>('shell.execute', {
      connectionId: connection.id,
      database: 'webtest',
      code: 'db.items.find({})',
      limit: 50,
      execId: crypto.randomUUID()
    })
    expect(result.kind).toBe('documents')
    if (result.kind !== 'documents') throw new Error('Expected documents.')
    const id = ((result.data as Array<{ _id: unknown }>)[0])._id

    expect(
      await rpc('docs.setField', {
        connectionId: connection.id,
        database: 'webtest',
        collection: 'items',
        id,
        path: 'count',
        valueEjson: '2'
      })
    ).toMatchObject({ ok: true, matched: 1, modified: 1 })
    expect((await mongo.client.db('webtest').collection('items').findOne())?.count).toBe(2)

    expect(
      await rpc('docs.delete', {
        connectionId: connection.id,
        database: 'webtest',
        collection: 'items',
        id
      })
    ).toMatchObject({ ok: true, deleted: 1 })
  })
})
