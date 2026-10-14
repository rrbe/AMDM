import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ConnectionInput, ShellResult, SchemaModel } from '../../src/shared/types'
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
  await app?.closeSessions()
  await new Promise<void>((resolve) => app?.server.close(resolve))
  await mongo?.stop()
})

const CLIENT_ID = '00000000-0000-4000-8000-000000000001'
async function callAs<T>(user: string, clientId: string, method: string, ...args: unknown[]): Promise<T> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://amdm.test',
      'x-forwarded-user': user
    },
    body: JSON.stringify({ method, args, clientId })
  })
  const body = (await response.json()) as { ok: boolean; result: T; error?: string }
  if (!body.ok) throw new Error(body.error)
  return body.result
}

const rpc = <T>(method: string, ...args: unknown[]): Promise<T> => callAs('alice@example.com', CLIENT_ID, method, ...args)

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
      pageSize: 50,
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

  it('pages one mongosh execution, isolates results by page/user, persists schemas, and cleans up on SSE close', async () => {
    const connection: ConnectionInput = {
      id: crypto.randomUUID(), name: 'Paging Mongo', useSrv: false,
      host: new URL(mongo.server.getUri()).host, auth: { type: 'none' },
      ssh: { enabled: false }, tls: { enabled: false }
    }
    await rpc('connections.save', connection)
    await rpc('session.connect', connection.id)
    const events = await fetch(rpcUrl.replace('/api/rpc', `/api/events?clientId=${CLIENT_ID}`), {
      headers: { 'x-forwarded-user': 'alice@example.com', origin: 'https://amdm.test' }
    })
    const items = mongo.client.db('webpaging').collection('items')
    await items.insertMany(Array.from({ length: 7 }, (_, n) => ({ n, nested: { label: `item${n}` } })))
    const result = await rpc<ShellResult>('shell.execute', {
      connectionId: connection.id, database: 'webpaging',
      code: 'db.executions.insertOne({ once: true }); db.items.find({}).sort({ n: 1 })',
      pageSize: 2, execId: crypto.randomUUID()
    })
    expect(result).toMatchObject({ kind: 'documents', count: 2, skip: 0, pageable: true })
    expect(result.resultId).toBeTruthy()
    const page = await rpc<ShellResult>('shell.page', { resultId: result.resultId, skip: 2, pageSize: 2, execId: crypto.randomUUID() })
    expect(page.data).toMatchObject([{ n: { $numberInt: '2' } }, { n: { $numberInt: '3' } }])
    expect(await mongo.client.db('webpaging').collection('executions').countDocuments()).toBe(1)
    expect(await rpc('shell.total', result.resultId)).toMatchObject({ totalStatus: 'known', totalCount: 7 })
    await expect(callAs('bob', CLIENT_ID, 'shell.page', { resultId: result.resultId, skip: 0, pageSize: 2, execId: crypto.randomUUID() })).rejects.toThrow('Result is closed')
    await expect(callAs('alice@example.com', crypto.randomUUID(), 'shell.total', result.resultId)).rejects.toThrow('Result is closed')
    const target = { connectionId: connection.id, database: 'webpaging', collection: 'items' }
    const schema = await rpc<SchemaModel>('schemas.analyze', target)
    expect(schema.analysis.sampleSize).toBe(7)
    const draft = { bsonType: 'object', required: ['n'] }
    await rpc('schemas.saveDraft', target, draft)
    expect(await rpc('schemas.analyze', target)).toMatchObject({ draft })
    expect(await rpc('schemas.overwriteDraft', target)).toMatchObject({ draft: schema.analysis.generated })
    await expect(callAs('bob', CLIENT_ID, 'schemas.get', target)).rejects.toThrow('Connection not found')
    const document = (result.data as Array<{ _id: unknown }>)[0]
    expect(await rpc('docs.read', { ...target, id: document._id, taskId: crypto.randomUUID() })).toMatchObject({ ok: true, found: true, document: { n: { $numberInt: '0' } } })
    await rpc('catalog.dropCollection', connection.id, 'webpaging', 'items')
    expect(await mongo.client.db('webpaging').listCollections({ name: 'items' }).toArray()).toEqual([])
    await events.body?.cancel()
    await expect.poll(async () => {
      try { await rpc('shell.total', result.resultId); return false } catch { return true }
    }).toBe(true)
    expect(await rpc('session.status', connection.id)).toMatchObject({ state: 'disconnected' })
  })

})
