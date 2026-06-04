/**
 * Catalog read core against a real MongoDB: collection listing (incl. views),
 * index introspection (key spec EJSON-serialized, unique/sparse/ttl flags), and
 * bounded field sampling for autocomplete.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Db } from 'mongodb'
import {
  listCollectionsOnDb,
  listIndexesOnDb,
  sampleFieldsOnDb
} from '../../src/main/mongo/catalogCore'
import { serializerPool } from '../../src/main/workers/serializerPool'
import { startMongo, type MongoHarness } from '../helpers/mongo'

let harness: MongoHarness
let db: Db

beforeAll(async () => {
  // Force inline field extraction (the worker bundle isn't built in tests).
  serializerPool.dispose()
  harness = await startMongo()
  db = harness.client.db('catalogtest')
}, 120_000)

afterAll(async () => {
  await harness?.stop()
})

beforeEach(async () => {
  await db.dropDatabase()
})

describe('listCollectionsOnDb', () => {
  it('lists collections and views by name and type', async () => {
    await db.createCollection('users')
    await db.createCollection('adults', {
      viewOn: 'users',
      pipeline: [{ $match: { age: { $gte: 18 } } }]
    })
    const cols = await listCollectionsOnDb(db)
    const byName = Object.fromEntries(cols.map((c) => [c.name, c.type]))
    expect(byName.users).toBe('collection')
    expect(byName.adults).toBe('view')
  })
})

describe('listIndexesOnDb', () => {
  it('returns the key spec (EJSON) and unique/sparse/ttl flags', async () => {
    await db.collection('c').insertOne({ a: 1 })
    await db.collection('c').createIndex({ a: 1, b: -1 }, { unique: true, sparse: true })
    await db.collection('c').createIndex({ created: 1 }, { expireAfterSeconds: 3600 })

    const idx = await listIndexesOnDb(db, 'c')
    const byName = Object.fromEntries(idx.map((i) => [i.name, i]))

    // The key spec is EJSON-canonical (numbers wrapped) — the renderer's ejson.ts
    // renders these back to 1 / -1.
    expect(byName._id_.key).toEqual({ _id: { $numberInt: '1' } })
    expect(byName['a_1_b_-1']).toMatchObject({
      key: { a: { $numberInt: '1' }, b: { $numberInt: '-1' } },
      unique: true,
      sparse: true
    })
    expect(byName.created_1).toMatchObject({
      key: { created: { $numberInt: '1' } },
      ttlSeconds: 3600
    })
  })
})

describe('sampleFieldsOnDb', () => {
  it('returns sorted dot-pathed field names across sampled docs', async () => {
    await db.collection('c').insertMany([
      { name: 'a', address: { city: 'x' } },
      { name: 'b', tags: [1, 2] }
    ])
    const fields = await sampleFieldsOnDb(db, 'c', 50)
    expect(fields).toContain('address')
    expect(fields).toContain('address.city')
    expect(fields).toContain('name')
    expect(fields).toContain('tags')
    expect([...fields]).toEqual([...fields].sort()) // sorted
  })

  it('honors the sample limit', async () => {
    await db.collection('c').insertMany([{ only: 1 }, { extra: 2 }, { more: 3 }])
    const fields = await sampleFieldsOnDb(db, 'c', 1)
    expect(fields).toEqual(['_id', 'only']) // only the first doc sampled (+ its _id)
  })
})
