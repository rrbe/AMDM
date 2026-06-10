/**
 * Shell-on-driver coverage (ADR-0003). Runs the real `runShellOnDb` against a
 * real MongoDB (mongodb-memory-server) and asserts on the EJSON-canonical wire
 * shape the renderer actually receives.
 *
 * Execution-model note: user code is transpiled with mongosh's async-rewriter2
 * before running in the `vm`, so driver promises (tagged synthetic by the
 * proxies / cursor prototype patches) are IMPLICITLY awaited at every step —
 * `const ids = db.x.distinct('k')` yields the array, and
 * `db.x.insertOne(); db.x.find()` sequences naturally, exactly like mongosh.
 * The completion value keeps REPL semantics (the last expression).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Db } from 'mongodb'
import { runShellOnDb, detectCollection } from '../../src/main/mongo/shellCore'
import type { RunShellOptions } from '../../src/main/mongo/shellCore'
import type { ShellResult } from '../../src/shared/types'
import { serializerPool } from '../../src/main/workers/serializerPool'
import { startMongo, type MongoHarness } from '../helpers/mongo'

let harness: MongoHarness
let db: Db

const run = (code: string, opts?: RunShellOptions): Promise<ShellResult> =>
  runShellOnDb(db, code, opts)

beforeAll(async () => {
  // Force the serializer pool to its inline path: the worker bundle isn't built
  // during unit tests, and inline uses the identical core helpers. This also
  // keeps serialization deterministic and avoids a doomed worker spawn.
  serializerPool.dispose()
  harness = await startMongo()
  db = harness.client.db('shelltest')
}, 120_000)

afterAll(async () => {
  await harness?.stop()
})

const SEED = [
  { n: 1, g: 'a' },
  { n: 2, g: 'a' },
  { n: 3, g: 'b' },
  { n: 4, g: 'b' },
  { n: 5, g: 'c' }
]

beforeEach(async () => {
  await db.dropDatabase()
  await db.collection('nums').insertMany(SEED.map((d) => ({ ...d })))
})

// ---------------------------------------------------------------------------
describe('BSON constructors / EJSON helpers', () => {
  it('round-trips every supported constructor through a real insert/find', async () => {
    const ack = await run(`db.types.insertOne({
      _id: 1,
      oid: ObjectId("64b8f0c2c9e77c0001a1b2c3"),
      oidNew: new ObjectId("64b8f0c2c9e77c0001a1b2c3"),
      date: ISODate("2020-01-02T03:04:05.000Z"),
      jsdate: new Date("2021-06-07T08:09:10.000Z"),
      lng: NumberLong("9007199254740993"),
      i32: NumberInt("42"),
      dec: NumberDecimal("3.14"),
      uuid: UUID("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"),
      bin: BinData(0, "aGVsbG8="),
      ts: Timestamp(1, 2),
      mn: MinKey(),
      mx: MaxKey()
    })`)
    expect(ack.kind).toBe('ack')

    const r = await run('db.types.findOne({ _id: 1 })')
    expect(r.kind).toBe('value')
    const doc = r.data as Record<string, any>

    expect(doc.oid).toEqual({ $oid: '64b8f0c2c9e77c0001a1b2c3' })
    expect(doc.oidNew).toEqual({ $oid: '64b8f0c2c9e77c0001a1b2c3' })
    expect(doc.date).toEqual({ $date: { $numberLong: String(Date.UTC(2020, 0, 2, 3, 4, 5)) } })
    expect(doc.jsdate).toEqual({
      $date: { $numberLong: String(Date.UTC(2021, 5, 7, 8, 9, 10)) }
    })
    expect(doc.lng).toEqual({ $numberLong: '9007199254740993' })
    expect(doc.i32).toEqual({ $numberInt: '42' })
    expect(doc.dec).toEqual({ $numberDecimal: '3.14' })
    expect(doc.uuid.$binary.subType).toBe('04')
    expect(doc.bin.$binary).toEqual({ base64: 'aGVsbG8=', subType: '00' })
    expect(doc.ts).toEqual({ $timestamp: { t: 1, i: 2 } })
    expect(doc.mn).toEqual({ $minKey: 1 })
    expect(doc.mx).toEqual({ $maxKey: 1 })
  })

  it('ObjectId() works with and without new, and exposes statics', async () => {
    const gen = await run('new ObjectId()')
    expect((gen.data as any).$oid).toMatch(/^[0-9a-f]{24}$/)

    const noNew = await run('ObjectId("64b8f0c2c9e77c0001a1b2c3")')
    expect(noNew.data).toEqual({ $oid: '64b8f0c2c9e77c0001a1b2c3' })

    expect((await run('ObjectId.isValid("64b8f0c2c9e77c0001a1b2c3")')).data).toBe(true)
    expect((await run('ObjectId.isValid("nope")')).data).toBe(false)
  })

  it('ISODate() with no arg returns a Date; Timestamp() defaults to (0,0)', async () => {
    const now = await run('ISODate()')
    expect((now.data as any).$date).toBeDefined()
    expect((await run('Timestamp()')).data).toEqual({ $timestamp: { t: 0, i: 0 } })
  })
})

// ---------------------------------------------------------------------------
describe('db proxy + mongosh-only helpers', () => {
  it('db.runCommand(cmd) maps to a real command (not a "runCommand" collection)', async () => {
    const r = await run('db.runCommand({ ping: 1 })')
    expect(r.kind).toBe('value')
    expect((r.data as any).ok).toBeDefined()
  })

  it('db.adminCommand(cmd) runs against admin', async () => {
    const r = await run('db.adminCommand({ ping: 1 })')
    expect(r.kind).toBe('value')
    expect((r.data as any).ok).toBeDefined()
  })

  it('db.getName() returns the database name', async () => {
    expect((await run('db.getName()')).data).toBe('shelltest')
  })

  it('db.version() returns the server version string', async () => {
    const r = await run('db.version()')
    expect(typeof r.data).toBe('string')
    expect(r.data as string).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('db.getCollectionNames() lists collection names', async () => {
    const r = await run('db.getCollectionNames()')
    expect(r.kind).toBe('documents')
    expect(r.data as string[]).toContain('nums')
  })

  it('db.getCollectionInfos() returns collection info objects', async () => {
    const r = await run('db.getCollectionInfos()')
    expect(r.kind).toBe('documents')
    expect((r.data as any[]).some((c) => c.name === 'nums')).toBe(true)
  })

  it('db.stats() returns database stats', async () => {
    const r = await run('db.stats()')
    expect(r.kind).toBe('value')
    expect((r.data as any).db).toBe('shelltest')
  })

  it('db.listCollections().toArray() drains the cursor', async () => {
    const r = await run('db.listCollections().toArray()')
    expect(r.kind).toBe('documents')
    expect((r.data as any[]).some((c) => c.name === 'nums')).toBe(true)
  })

  it('db.aggregate() runs a collectionless pipeline', async () => {
    const r = await run('db.aggregate([{ $documents: [{ x: 1 }, { x: 2 }] }, { $match: { x: { $gte: 1 } } }])')
    expect(r.kind).toBe('documents')
    expect(r.count).toBe(2)
  })

  it('db.getSiblingDB(name) targets another database', async () => {
    await harness.client.db('otherdb').dropDatabase()
    await harness.client.db('otherdb').collection('c').insertOne({ z: 1 })
    const r = await run('db.getSiblingDB("otherdb").c.find({})')
    expect(r.kind).toBe('documents')
    expect(r.count).toBe(1)
    await harness.client.db('otherdb').dropDatabase()
  })

  it('db.getCollection(name) supports names that are not valid identifiers', async () => {
    await run('db.getCollection("weird-name").insertOne({ a: 1 })')
    const r = await run('db.getCollection("weird-name").find({})')
    expect(r.kind).toBe('documents')
    expect(r.count).toBe(1)
  })

  it('db["dashed-coll"] bracket access works', async () => {
    await db.collection('dashed-coll').insertOne({ k: 1 })
    const r = await run('db["dashed-coll"].find({})')
    expect(r.kind).toBe('documents')
    expect(r.count).toBe(1)
  })
})

// ---------------------------------------------------------------------------
describe('collection queries', () => {
  it('find({}) returns all docs, bounded but untruncated for small sets', async () => {
    const r = await run('db.nums.find({})')
    expect(r.kind).toBe('documents')
    expect(r.count).toBe(5)
    expect(r.truncated).toBe(false)
  })

  it('find(filter) filters', async () => {
    expect((await run('db.nums.find({ g: "a" })')).count).toBe(2)
  })

  it('find(query, projection) treats the 2nd arg as a projection (mongosh)', async () => {
    const r = await run('db.nums.find({}, { n: 1, _id: 0 })')
    expect(r.kind).toBe('documents')
    for (const d of r.data as Record<string, unknown>[]) {
      expect(Object.keys(d)).toEqual(['n'])
    }
  })

  it('findOne(query, projection) projects too', async () => {
    const r = await run('db.nums.findOne({ n: 3 }, { g: 1, _id: 0 })')
    expect(r.kind).toBe('value')
    expect(r.data).toEqual({ g: 'b' })
  })

  it('db.collection(name).find(q, projection) — driver-style accessor still shims projection', async () => {
    const r = await run('db.collection("nums").find({}, { n: 1, _id: 0 })')
    for (const d of r.data as Record<string, unknown>[]) {
      expect(Object.keys(d)).toEqual(['n'])
    }
  })

  it('chains sort/limit/skip', async () => {
    const desc = await run('db.nums.find().sort({ n: -1 }).limit(2)')
    expect((desc.data as any[]).map((d) => d.n.$numberInt)).toEqual(['5', '4'])

    const skipped = await run('db.nums.find().sort({ n: 1 }).skip(3)')
    expect((skipped.data as any[]).map((d) => d.n.$numberInt)).toEqual(['4', '5'])
  })

  it('cursor.projection(spec) alias and native project(spec) both work', async () => {
    for (const code of [
      'db.nums.find().projection({ n: 1, _id: 0 })',
      'db.nums.find().project({ n: 1, _id: 0 })'
    ]) {
      const r = await run(code)
      for (const d of r.data as Record<string, unknown>[]) {
        expect(Object.keys(d)).toEqual(['n'])
      }
    }
  })

  it('cursor.itcount()/size() report counts', async () => {
    expect((await run('db.nums.find().itcount()')).data).toEqual({ $numberInt: '5' })
    expect((await run('db.nums.find().size()')).data).toEqual({ $numberInt: '5' })
  })

  it('cursor.count() reports a count', async () => {
    expect((await run('db.nums.find().count()')).data).toEqual({ $numberInt: '5' })
  })

  it('cursor.pretty() is a chainable no-op', async () => {
    const r = await run('db.nums.find().pretty()')
    expect(r.kind).toBe('documents')
    expect(r.count).toBe(5)
  })

  it('cursor.map() transforms then drains', async () => {
    const r = await run('db.nums.find().sort({ n: 1 }).map(d => d.n)')
    expect(r.kind).toBe('documents')
    expect((r.data as any[]).map((v) => v.$numberInt)).toEqual(['1', '2', '3', '4', '5'])
  })

  it('cursor.forEach() resolves to undefined (no error)', async () => {
    const r = await run('db.nums.find().forEach(printjson)')
    expect(r.kind).toBe('value')
    expect(r.data).toBeNull()
  })

  it('cursor.next()/hasNext() work', async () => {
    expect((await run('db.nums.find().hasNext()')).data).toBe(true)
    const next = await run('db.nums.find().sort({ n: 1 }).next()')
    expect((next.data as any).n).toEqual({ $numberInt: '1' })
  })

  it('find().toArray() materializes', async () => {
    const r = await run('db.nums.find().toArray()')
    expect(r.kind).toBe('documents')
    expect(r.count).toBe(5)
  })

  it('countDocuments / estimatedDocumentCount return numbers', async () => {
    expect((await run('db.nums.countDocuments({})')).data).toEqual({ $numberInt: '5' })
    expect((await run('db.nums.countDocuments({ g: "b" })')).data).toEqual({ $numberInt: '2' })
    expect((await run('db.nums.estimatedDocumentCount()')).data).toEqual({ $numberInt: '5' })
  })

  it('distinct returns an array', async () => {
    const r = await run('db.nums.distinct("g")')
    expect(r.kind).toBe('documents')
    expect([...(r.data as string[])].sort()).toEqual(['a', 'b', 'c'])
  })

  it('default page limit truncates a large cursor (one extra fetched)', async () => {
    await db.collection('big').insertMany(
      Array.from({ length: 60 }, (_, i) => ({ i }))
    )
    const r = await run('db.big.find({})')
    expect(r.count).toBe(50)
    expect(r.truncated).toBe(true)
  })

  it('FindCursor is pageable; skip fetches the next page', async () => {
    await db.collection('paged').insertMany(Array.from({ length: 60 }, (_, i) => ({ i })))
    const p1 = await run('db.paged.find({}).sort({ i: 1 })', { limit: 50, skip: 0 })
    expect(p1.pageable).toBe(true)
    expect(p1.skip).toBe(0)
    expect(p1.count).toBe(50)
    expect(p1.truncated).toBe(true)
    expect(Number((p1.data as any[])[0].i.$numberInt)).toBe(0)

    const p2 = await run('db.paged.find({}).sort({ i: 1 })', { limit: 50, skip: 50 })
    expect(p2.skip).toBe(50)
    expect(p2.count).toBe(10)
    expect(p2.truncated).toBe(false)
    expect(Number((p2.data as any[])[0].i.$numberInt)).toBe(50)
  })

  it('AggregationCursor is not pageable', async () => {
    const r = await run('db.nums.aggregate([{ $match: {} }])')
    expect(r.kind).toBe('documents')
    expect(r.pageable).toBe(false)
  })
})

// ---------------------------------------------------------------------------
describe('aggregation', () => {
  it('aggregate([...]) groups and sorts', async () => {
    const r = await run(
      'db.nums.aggregate([{ $group: { _id: "$g", total: { $sum: "$n" } } }, { $sort: { _id: 1 } }])'
    )
    expect(r.kind).toBe('documents')
    expect(r.count).toBe(3)
    const rows = r.data as any[]
    expect(rows[0]._id).toBe('a')
    expect(rows[0].total).toEqual({ $numberInt: '3' })
  })

  it('aggregate([...]).toArray() materializes', async () => {
    const r = await run('db.nums.aggregate([{ $match: { g: "b" } }]).toArray()')
    expect(r.kind).toBe('documents')
    expect(r.count).toBe(2)
  })
})

// ---------------------------------------------------------------------------
describe('write operations return write-acknowledgements', () => {
  it('insertOne', async () => {
    const r = await run('db.w.insertOne({ a: 1 })')
    expect(r.kind).toBe('ack')
    expect((r.data as any).acknowledged).toBe(true)
    expect((r.data as any).insertedId).toBeDefined()
  })

  it('insertMany', async () => {
    const r = await run('db.w.insertMany([{ a: 1 }, { a: 2 }])')
    expect(r.kind).toBe('ack')
    expect((r.data as any).insertedCount).toEqual({ $numberInt: '2' })
  })

  it('updateOne', async () => {
    await db.collection('w').insertOne({ a: 1 })
    const r = await run('db.w.updateOne({ a: 1 }, { $set: { b: 2 } })')
    expect(r.kind).toBe('ack')
    expect((r.data as any).matchedCount).toEqual({ $numberInt: '1' })
    expect((r.data as any).modifiedCount).toEqual({ $numberInt: '1' })
  })

  it('updateMany', async () => {
    await db.collection('w').insertMany([{ a: 1 }, { a: 1 }])
    const r = await run('db.w.updateMany({ a: 1 }, { $set: { b: 9 } })')
    expect((r.data as any).modifiedCount).toEqual({ $numberInt: '2' })
  })

  it('replaceOne', async () => {
    await db.collection('w').insertOne({ a: 1 })
    const r = await run('db.w.replaceOne({ a: 1 }, { a: 1, c: 9 })')
    expect((r.data as any).modifiedCount).toEqual({ $numberInt: '1' })
  })

  it('deleteOne / deleteMany', async () => {
    await db.collection('w').insertMany([{ a: 1 }, { a: 1 }, { a: 2 }])
    expect((await run('db.w.deleteOne({ a: 1 })') as any).data.deletedCount).toEqual({
      $numberInt: '1'
    })
    expect((await run('db.w.deleteMany({})') as any).data.deletedCount).toEqual({ $numberInt: '2' })
  })

  it('bulkWrite', async () => {
    const r = await run(
      'db.w.bulkWrite([{ insertOne: { document: { a: 1 } } }, { insertOne: { document: { a: 2 } } }])'
    )
    expect(r.kind).toBe('ack')
    expect((r.data as any).insertedCount).toEqual({ $numberInt: '2' })
  })

  it('findOneAndUpdate returns the document (value, not ack)', async () => {
    await db.collection('w').insertOne({ a: 1, v: 1 })
    const r = await run('db.w.findOneAndUpdate({ a: 1 }, { $set: { v: 2 } })')
    expect(r.kind).toBe('value')
    expect((r.data as any).a).toEqual({ $numberInt: '1' })
  })
})

// ---------------------------------------------------------------------------
describe('index operations', () => {
  it('createIndex returns the index name', async () => {
    const r = await run('db.nums.createIndex({ n: 1 })')
    expect(r.kind).toBe('value')
    expect(r.data).toBe('n_1')
  })

  it('getIndexes() (mongosh) maps to indexes()', async () => {
    await db.collection('nums').createIndex({ n: 1 })
    const r = await run('db.nums.getIndexes()')
    expect(r.kind).toBe('documents')
    const names = (r.data as any[]).map((i) => i.name)
    expect(names).toContain('_id_')
    expect(names).toContain('n_1')
  })

  it('listIndexes().toArray() and indexes() both list indexes', async () => {
    await db.collection('nums').createIndex({ g: 1 })
    expect((await run('db.nums.listIndexes().toArray()')).kind).toBe('documents')
    expect((await run('db.nums.indexes()')).kind).toBe('documents')
  })

  it('dropIndex removes an index', async () => {
    await db.collection('nums').createIndex({ n: 1 }, { name: 'n_idx' })
    const r = await run('db.nums.dropIndex("n_idx")')
    expect(r.kind).toBe('value')
  })
})

// ---------------------------------------------------------------------------
describe('explain', () => {
  it('explains a find() with executionStats', async () => {
    const r = await run('db.nums.find({ n: 3 })', { explain: true })
    expect(r.kind).toBe('explain')
    expect((r.data as any).queryPlanner).toBeDefined()
  })

  it('explains an aggregate()', async () => {
    const r = await run('db.nums.aggregate([{ $match: { g: "a" } }])', { explain: true })
    expect(r.kind).toBe('explain')
  })

  it('errors when explain target is not a query', async () => {
    const r = await run('1 + 1', { explain: true })
    expect(r.kind).toBe('error')
    expect(r.errorName).toBe('ExplainError')
  })
})

// ---------------------------------------------------------------------------
describe('REPL completion-value shapes', () => {
  it('arithmetic → value', async () => {
    expect((await run('1 + 1')).data).toEqual({ $numberInt: '2' })
  })
  it('string → value', async () => {
    expect((await run('"hello"')).data).toBe('hello')
  })
  it('plain object → value', async () => {
    const r = await run('({ a: 1, b: "x" })')
    expect(r.kind).toBe('value')
    expect(r.data).toEqual({ a: { $numberInt: '1' }, b: 'x' })
  })
  it('array literal → documents', async () => {
    const r = await run('[1, 2, 3]')
    expect(r.kind).toBe('documents')
    expect(r.count).toBe(3)
  })
  it('null → value null', async () => {
    expect((await run('null')).data).toBeNull()
  })
  it('print/printjson/console.log are no-ops; trailing expression is the value', async () => {
    expect((await run('print("hi"); printjson({a:1}); console.log("x"); 42')).data).toEqual({
      $numberInt: '42'
    })
  })
})

// ---------------------------------------------------------------------------
describe('errors surface (never silent)', () => {
  it('syntax error', async () => {
    const r = await run('(((')
    expect(r.kind).toBe('error')
    expect(r.errorName).toBe('SyntaxError')
  })

  it('unknown helper method errors instead of silently mis-behaving', async () => {
    const r = await run('db.nums.bogusHelper()')
    expect(r.kind).toBe('error')
    expect(r.errorName).toBe('TypeError')
  })

  it('reference error for undefined identifiers', async () => {
    const r = await run('totallyUndefinedThing')
    expect(r.kind).toBe('error')
    expect(r.errorName).toBe('ReferenceError')
  })

  it('server-side query error is reported', async () => {
    const r = await run('db.nums.find({ $invalidTopLevelOp: 1 })')
    expect(r.kind).toBe('error')
  })
})

// ---------------------------------------------------------------------------
describe('abort / stop (AbortSignal cancellation)', () => {
  const abortedSignal = (): AbortSignal => {
    const c = new AbortController()
    c.abort()
    return c.signal
  }

  it('a pre-aborted find returns a clean Aborted result (cursor path)', async () => {
    const r = await run('db.nums.find({})', { signal: abortedSignal() })
    expect(r.kind).toBe('error')
    expect(r.errorName).toBe('Aborted')
  })

  it('a pre-aborted aggregate returns Aborted (cursor path)', async () => {
    const r = await run('db.nums.aggregate([{ $match: {} }])', { signal: abortedSignal() })
    expect(r.kind).toBe('error')
    expect(r.errorName).toBe('Aborted')
  })

  it('a pre-aborted promise op bails via the abort race (countDocuments)', async () => {
    const r = await run('db.nums.countDocuments({})', { signal: abortedSignal() })
    expect(r.kind).toBe('error')
    expect(r.errorName).toBe('Aborted')
  })

  it('a pre-aborted explain returns Aborted', async () => {
    const r = await run('db.nums.find({})', { signal: abortedSignal(), explain: true })
    expect(r.kind).toBe('error')
    expect(r.errorName).toBe('Aborted')
  })

  it('an un-aborted signal leaves normal queries untouched (no regression)', async () => {
    const r = await run('db.nums.find({})', { signal: new AbortController().signal })
    expect(r.kind).toBe('documents')
    expect(r.count).toBe(5)
  })
})

// ---------------------------------------------------------------------------
describe('collection detection (drives doc edit/delete)', () => {
  it('detects via dot, getCollection, and bracket; ignores db methods', () => {
    expect(detectCollection('db.lives.find({})')).toBe('lives')
    expect(detectCollection('db.getCollection("foo-bar").find()')).toBe('foo-bar')
    expect(detectCollection('db["x-y"].find()')).toBe('x-y')
    expect(detectCollection('db.runCommand({ ping: 1 })')).toBeUndefined()
    expect(detectCollection('db.getCollectionNames()')).toBeUndefined()
  })

  it('surfaces the detected collection on results', async () => {
    expect((await run('db.lives.find({})')).collection).toBe('lives')
    expect((await run('db.getCollection("foo-bar").find({})')).collection).toBe('foo-bar')
  })
})

// ---------------------------------------------------------------------------
describe('console output capture (print / printjson / console.*)', () => {
  it('captures print lines in call order and still returns the completion value', async () => {
    const r = await run(`print('start'); print('n =', 42); db.nums.countDocuments({})`)
    expect(r.kind).toBe('value')
    expect(r.data).toEqual({ $numberInt: '5' })
    expect(r.output).toEqual([
      { kind: 'text', text: 'start', level: 'log' },
      { kind: 'text', text: 'n = 42', level: 'log' }
    ])
    expect(r.outputTruncated).toBeUndefined()
  })

  it('printjson serializes BSON to EJSON-canonical; console.error/warn carry levels', async () => {
    const r = await run(
      `printjson({ id: ObjectId('65f1a2b3c4d5e6f7a8b9c0d1'), big: NumberLong('9007199254740993') });
       console.error('bad'); console.warn('meh'); console.log('ok');
       null`
    )
    expect(r.kind).toBe('value')
    expect(r.output?.[0]).toEqual({
      kind: 'json',
      data: { id: { $oid: '65f1a2b3c4d5e6f7a8b9c0d1' }, big: { $numberLong: '9007199254740993' } },
      level: 'log'
    })
    expect(r.output?.slice(1)).toEqual([
      { kind: 'text', text: 'bad', level: 'error' },
      { kind: 'text', text: 'meh', level: 'warn' },
      { kind: 'text', text: 'ok', level: 'log' }
    ])
  })

  it('print with a BSON object argument inlines it as compact EJSON', async () => {
    const r = await run(`print('doc:', { n: NumberInt(7) }); null`)
    expect(r.output?.[0]).toEqual({ kind: 'text', text: 'doc: {"n":{"$numberInt":"7"}}', level: 'log' })
  })

  it('cursor.forEach(printjson) streams docs into the output (script-only run)', async () => {
    const r = await run(`db.nums.find({}).sort({ n: 1 }).forEach(printjson)`)
    // forEach resolves to undefined → a value-null result whose payload is the output.
    expect(r.kind).toBe('value')
    expect(r.data).toBeNull()
    expect(r.output).toHaveLength(5)
    expect(r.output?.every((l) => l.kind === 'json')).toBe(true)
    expect((r.output?.[0].data as { n: unknown }).n).toEqual({ $numberInt: '1' })
  })

  it('documents results carry output alongside the docs', async () => {
    const r = await run(`print('querying'); db.nums.find({})`)
    expect(r.kind).toBe('documents')
    expect(r.count).toBe(5)
    expect(r.output).toEqual([{ kind: 'text', text: 'querying', level: 'log' }])
  })

  it('an error keeps the output printed before the failure', async () => {
    const r = await run(`print('step 1 ok'); nope()`)
    expect(r.kind).toBe('error')
    expect(r.errorName).toBe('ReferenceError')
    expect(r.output).toEqual([{ kind: 'text', text: 'step 1 ok', level: 'log' }])
  })

  it('caps captured lines at MAX_OUTPUT_LINES and flags truncation', async () => {
    const r = await run(`for (let i = 0; i < 1500; i++) print('line', i); null`)
    expect(r.output).toHaveLength(1000)
    expect(r.outputTruncated).toBe(true)
    expect(r.output?.[999]).toEqual({ kind: 'text', text: 'line 999', level: 'log' })
  })

  it('results with no printed output omit the output field entirely', async () => {
    const r = await run(`db.nums.find({})`)
    expect(r.output).toBeUndefined()
    expect(r.outputTruncated).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
describe('implicit await (async-rewriter2)', () => {
  it('assigns the resolved value of a driver call, not the Promise', async () => {
    const r = await run(`const ids = db.nums.distinct('g'); ids`)
    expect(r.kind).toBe('documents') // distinct → array
    expect(r.data).toEqual(['a', 'b', 'c'])
  })

  it('spreads a distinct result and feeds it back into a query', async () => {
    const r = await run(`
      const groups = db.nums.distinct('g', { n: { $lte: 2 } });
      const more = db.nums.distinct('g', { n: { $gte: 4 } });
      const all = [...groups, ...more];
      db.nums.find({ g: { $in: all } }).sort({ n: 1 })
    `)
    expect(r.kind).toBe('documents')
    // groups=[a], more=[b,c] → matches all five docs
    expect(r.count).toBe(5)
  })

  it('interpolates countDocuments into a template literal (命令2 shape)', async () => {
    const r = await run(`
      const branches = { low: { n: { $lt: 3 } }, high: { n: { $gte: 3 } } };
      for (const [name, cond] of Object.entries(branches)) {
        print(\`\${name}: \${db.nums.countDocuments(cond)}\`);
      }
      const total = db.nums.countDocuments({ $or: Object.values(branches) });
      print(\`total: \${total}\`);
      null
    `)
    expect(r.kind).toBe('value')
    expect(r.output?.map((l) => l.text)).toEqual(['low: 2', 'high: 3', 'total: 5'])
  })

  it('sequences write-then-read across statements', async () => {
    const r = await run(`db.w.insertOne({ a: 1 }); db.w.insertOne({ a: 2 }); db.w.countDocuments({})`)
    expect(r.kind).toBe('value')
    expect(r.data).toEqual({ $numberInt: '2' })
  })

  it('explicit toArray() resolves to the full array (documents result)', async () => {
    const r = await run(`const docs = db.nums.find({}).projection({ _id: 0, n: 1 }).toArray(); docs.length`)
    expect(r.kind).toBe('value')
    expect(r.data).toEqual({ $numberInt: '5' })
  })

  it('aggregate().toArray() inside a script materializes (命令1 shape)', async () => {
    const r = await run(`
      const pmIds = db.nums.distinct('n', { g: 'a' });
      db.nums.aggregate([
        { $match: { n: { $in: pmIds } } },
        { $project: { _id: 0, n: 1 } },
        { $sort: { n: 1 } }
      ]).toArray()
    `)
    expect(r.kind).toBe('documents')
    expect(r.data).toEqual([{ n: { $numberInt: '1' } }, { n: { $numberInt: '2' } }])
  })

  it('top-level await still works for explicit user promises', async () => {
    const r = await run(`const v = await Promise.resolve(41); v + 1`)
    expect(r.kind).toBe('value')
    expect(r.data).toEqual({ $numberInt: '42' })
  })

  it('a bare trailing cursor still pages (not implicitly drained)', async () => {
    const r = await run(`print('hi'); db.nums.find({})`, { limit: 2 })
    expect(r.kind).toBe('documents')
    expect(r.count).toBe(2)
    expect(r.truncated).toBe(true)
    expect(r.pageable).toBe(true)
  })

  it('an error mid-script still surfaces with prior output intact', async () => {
    const r = await run(`const c = db.nums.countDocuments({}); print('count = ' + c); boom()`)
    expect(r.kind).toBe('error')
    expect(r.errorName).toBe('ReferenceError')
    expect(r.output).toEqual([{ kind: 'text', text: 'count = 5', level: 'log' }])
  })
})
