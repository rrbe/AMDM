/**
 * Document mutation core against a real MongoDB. This is the riskiest path in
 * the app (a wrong _id deserialization = the wrong document edited/deleted), so
 * it gets real-driver coverage: edit/replace/delete by _id, _id immutability,
 * BSON-type preservation, and string/numeric _id round-trips.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ObjectId } from 'bson'
import type { Db } from 'mongodb'
import {
  replaceDocumentOnDb,
  setFieldOnDb,
  deleteDocumentOnDb
} from '../../src/main/mongo/docOpsCore'
import { startMongo, type MongoHarness } from '../helpers/mongo'

let harness: MongoHarness
let db: Db

beforeAll(async () => {
  harness = await startMongo()
  db = harness.client.db('docopstest')
}, 120_000)

afterAll(async () => {
  await harness?.stop()
})

beforeEach(async () => {
  await db.dropDatabase()
})

const oidEjson = (oid: ObjectId): { $oid: string } => ({ $oid: oid.toHexString() })

describe('replaceDocumentOnDb', () => {
  it('replaces by _id, dropping removed fields', async () => {
    const oid = new ObjectId()
    await db.collection('c').insertOne({ _id: oid, a: 1, b: 2 })
    const res = await replaceDocumentOnDb(db, 'c', oidEjson(oid), '{"a":9,"c":3}')
    expect(res).toMatchObject({ ok: true, matched: 1, modified: 1 })
    const doc = await db.collection('c').findOne({ _id: oid })
    expect(doc).toEqual({ _id: oid, a: 9, c: 3 }) // b gone, _id preserved
  })

  it('never changes the _id even if the replacement carries a different one', async () => {
    const oid = new ObjectId()
    await db.collection('c').insertOne({ _id: oid, a: 1 })
    const other = new ObjectId()
    const res = await replaceDocumentOnDb(db, 'c', oidEjson(oid), JSON.stringify({ _id: oidEjson(other), a: 7 }))
    expect(res.ok).toBe(true)
    expect(await db.collection('c').findOne({ _id: other })).toBeNull()
    expect(await db.collection('c').findOne({ _id: oid })).toMatchObject({ a: 7 })
  })
})

describe('setFieldOnDb', () => {
  it('sets one field by $set', async () => {
    const oid = new ObjectId()
    await db.collection('c').insertOne({ _id: oid, a: 1 })
    const res = await setFieldOnDb(db, 'c', oidEjson(oid), 'a', '5')
    expect(res).toMatchObject({ ok: true, matched: 1, modified: 1 })
    expect((await db.collection('c').findOne({ _id: oid }))?.a).toBe(5)
  })

  it('sets a nested dotted path', async () => {
    const oid = new ObjectId()
    await db.collection('c').insertOne({ _id: oid, nested: {} })
    await setFieldOnDb(db, 'c', oidEjson(oid), 'nested.city', '"shanghai"')
    expect((await db.collection('c').findOne({ _id: oid }))?.nested).toEqual({ city: 'shanghai' })
  })

  it('refuses to edit _id', async () => {
    const oid = new ObjectId()
    await db.collection('c').insertOne({ _id: oid })
    const res = await setFieldOnDb(db, 'c', oidEjson(oid), '_id', '"nope"')
    expect(res.ok).toBe(false)
    expect(res.error).toContain('_id')
  })

  it('preserves BSON numeric types from wrapped EJSON (regression: no Int→Double widening)', async () => {
    const oid = new ObjectId()
    await db.collection('c').insertOne({ _id: oid })
    await setFieldOnDb(db, 'c', oidEjson(oid), 'n', JSON.stringify({ $numberLong: '42' }))
    await setFieldOnDb(db, 'c', oidEjson(oid), 'm', JSON.stringify({ $numberInt: '7' }))
    // promoteValues:false keeps the raw BSON wrappers. Compare by _bsontype, not
    // instanceof: the driver bundles its own bson copy, so its Long/Int32 class
    // identity differs from the test's imported one.
    const raw = await db.collection('c').findOne({ _id: oid }, { promoteValues: false })
    expect((raw?.n as { _bsontype?: string })?._bsontype).toBe('Long')
    expect(Number(raw?.n)).toBe(42)
    expect((raw?.m as { _bsontype?: string })?._bsontype).toBe('Int32')
    expect(Number(raw?.m)).toBe(7)
  })
})

describe('deleteDocumentOnDb', () => {
  it('deletes by ObjectId _id', async () => {
    const oid = new ObjectId()
    await db.collection('c').insertOne({ _id: oid, a: 1 })
    expect(await deleteDocumentOnDb(db, 'c', oidEjson(oid))).toMatchObject({ ok: true, deleted: 1 })
    expect(await db.collection('c').findOne({ _id: oid })).toBeNull()
  })

  it('reports zero deletions for a missing _id', async () => {
    expect(await deleteDocumentOnDb(db, 'c', oidEjson(new ObjectId()))).toMatchObject({
      ok: true,
      deleted: 0
    })
  })

  it('handles a plain string _id (passed through, not EJSON-deserialized)', async () => {
    await db.collection('c').insertOne({ _id: 'abc' as never, a: 1 })
    expect(await deleteDocumentOnDb(db, 'c', 'abc')).toMatchObject({ ok: true, deleted: 1 })
  })
})
