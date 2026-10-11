import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Collection, MongoClient } from 'mongodb'
import { EJSON } from 'bson'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { executeShell, readShellPage, readShellTotal, releaseShellResult } from '../../src/main/mongo/shellEngine'
import { shellResults } from '../../src/main/mongo/shellResults'
import type { ShellResult } from '../../src/shared/types'

vi.mock('../../src/main/mongo/sessionManager', () => ({ sessionManager: { getClient: () => client } }))
let replicaSet: MongoMemoryReplSet
let client: MongoClient
const owner = 7
const run = (code: string, pageSize = 2) => executeShell({ connectionId: 'paging', database: 'paging', code, pageSize }, owner)
const page = (result: ShellResult, skip: number, pageSize = 2) => readShellPage({ resultId: result.resultId!, skip, pageSize, execId: 'page' }, owner)
const numbers = (result: ShellResult) => (EJSON.deserialize(result.data) as { n: number }[]).map((doc) => doc.n)

beforeAll(async () => {
  replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
  client = new MongoClient(replicaSet.getUri())
  await client.connect()
}, 120_000)
beforeEach(async () => {
  await client.db('paging').dropDatabase()
  await client.db('paging').collection('items').insertMany(Array.from({ length: 7 }, (_, n) => ({ n })))
})
afterEach(() => shellResults.closeConnection('paging'))
afterAll(async () => { await client?.close(); await replicaSet?.stop() })

describe('execution-owned result pages', () => {
  it('respects query limit and skip independently from the display size and counts the actual result', async () => {
    const result = await run('db.items.find({n:{$gte:1}}).sort({n:1}).skip(1).limit(3)')
    expect(numbers(result)).toEqual([2, 3])
    await expect(readShellTotal(result.resultId!, owner)).resolves.toEqual({ totalStatus: 'known', totalCount: 3 })
    const next = await page(result, 2)
    expect(numbers(next)).toEqual([4])
    expect(next).toMatchObject({ totalCount: 3, truncated: false, skip: 2 })
    const larger = await page(result, 0, 10)
    expect(numbers(larger)).toEqual([2, 3, 4])
    expect(larger).toMatchObject({ totalCount: 3, pageSize: 10, skip: 0 })
  })

  it('changing display size or browsing backwards never repeats script writes or console output', async () => {
    const result = await run(`db.effects.updateOne({_id:1}, {$inc:{runs:1}}, {upsert:true}); print('once'); db.items.find().sort({n:1})`)
    await page(result, 2)
    await page(result, 0, 5)
    await page(result, 5, 5)
    await page(result, 0, 2)
    expect(await client.db('paging').collection('effects').findOne({ _id: 1 } as never)).toMatchObject({ runs: 1 })
    expect(result.output).toHaveLength(1)
    expect(numbers(await page(result, 0))).toEqual([0, 1])
  })

  it('retains already-read pages when the database changes', async () => {
    const result = await run('db.items.find().sort({n:1})')
    await client.db('paging').collection('items').updateMany({n:{$lt:2}}, {$set:{n:99}})
    expect(numbers(await page(result, 0))).toEqual([0, 1])
  })

  it('counts collation and a query limit larger than the matching data', async () => {
    await client.db('paging').collection('names').insertMany([{name:'A'}, {name:'a'}, {name:'B'}])
    const result = await run('db.names.find({name:"a"}).collation({locale:"en",strength:2}).limit(100)', 1)
    await expect(readShellTotal(result.resultId!, owner)).resolves.toMatchObject({ totalCount: 2 })
    expect((await page(result, 1, 1)).count).toBe(1)
  })

  it('pages aggregation output without replaying the pipeline and confirms the total at exhaustion', async () => {
    const result = await run('db.items.aggregate([{$match:{n:{$gte:2}}},{$sort:{n:1}},{$limit:3}])')
    expect(numbers(result)).toEqual([2, 3])
    expect(result).toMatchObject({ pageable: true, totalStatus: 'unknown' })
    const next = await page(result, 2)
    expect(numbers(next)).toEqual([4])
    expect(next).toMatchObject({ totalCount: 3, totalStatus: 'known', truncated: false })
  })

  it.each(['db.items.find().sort({n:1}).limit(4).toArray()', '[{n:0},{n:1},{n:2},{n:3}]'])('pages explicit arrays: %s', async (code) => {
    const result = await run(code)
    expect(result).toMatchObject({ count: 2, totalCount: 4, truncated: true, pageable: true })
    expect(numbers(await page(result, 2))).toEqual([2, 3])
    expect((await page(result, 0, 10)).count).toBe(4)
  })

  it('pages Driver cursors and does not use the display size as a query limit', async () => {
    const result = await run('driverDb.collection("items").find().sort({n:1}).limit(5)')
    expect(numbers(result)).toEqual([0, 1])
    await expect(readShellTotal(result.resultId!, owner)).resolves.toMatchObject({ totalCount: 5 })
    expect(numbers(await page(result, 0, 10))).toEqual([0, 1, 2, 3, 4])
  })

  it('shows exact zero for an empty result', async () => {
    const result = await run('db.items.find({n:-1})')
    expect(result).toMatchObject({ data: [], count: 0, totalCount: 0, totalStatus: 'known', truncated: false })
  })

  it('does not miscount a cursor already consumed by the script', async () => {
    const result = await run('const c = db.items.find().sort({n:1}); c.next(); c')
    expect(numbers(result)).toEqual([1, 2])
    expect(result.totalStatus).toBe('unknown')
    expect((await page(result, 0, 10)).totalCount).toBe(6)
  })

  it('reports count failure explicitly while keeping pages usable and confirms the total on exhaustion', async () => {
    const count = vi.spyOn(Collection.prototype, 'countDocuments').mockRejectedValueOnce(new Error('count unavailable'))
    try {
      const result = await run('db.items.find().sort({n:1})')
      await expect(readShellTotal(result.resultId!, owner)).resolves.toEqual({ totalStatus: 'unavailable' })
      const all = await page(result, 0, 10)
      expect(numbers(all)).toEqual([0, 1, 2, 3, 4, 5, 6])
      expect(all).toMatchObject({ totalStatus: 'known', totalCount: 7 })
    } finally {
      count.mockRestore()
    }
  })

  it('releases cursors and private cached files on close, and enforces Renderer ownership', async () => {
    const result = await run('db.items.find()')
    const session = shellResults.get(result.resultId!, owner)
    const directory = (session as unknown as {directory:string}).directory
    await expect(readShellTotal(result.resultId!, owner + 1)).rejects.toThrow('closed')
    await releaseShellResult(result.resultId!, owner)
    const { access } = await import('node:fs/promises')
    await expect(access(directory)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(page(result, 0)).rejects.toThrow('closed')
  })
})
