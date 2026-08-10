import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Db } from 'mongodb'
import { analyzeCollectionSchemaOnDb } from '../../src/main/mongo/schemaAnalysisCore'
import { serializerPool } from '../../src/main/workers/serializerPool'
import { startMongo, type MongoHarness } from '../helpers/mongo'

let harness: MongoHarness
let db: Db

beforeAll(async () => {
  // The worker bundle does not exist during source-level tests; exercise the shared inline core.
  serializerPool.dispose()
  harness = await startMongo()
  db = harness.client.db('schema-analysis-test')
}, 120_000)

afterAll(async () => {
  await harness?.stop()
})

beforeEach(async () => {
  await db.dropDatabase()
})

describe('analyzeCollectionSchemaOnDb', () => {
  it('infers nested and mixed BSON types from a bounded random sample', async () => {
    await db.collection('events').insertMany(
      Array.from({ length: 80 }, (_, index) => ({
        common: true,
        profile: { name: `user-${index}` },
        mixed: index % 2 === 0 ? index : String(index),
        tags: [{ value: index }]
      }))
    )

    const analysis = await analyzeCollectionSchemaOnDb(db, 'events', 30_000)
    expect(analysis.sampleSize).toBe(50)
    expect(analysis.fields.map((field) => field.name)).toContain('profile')
    expect(analysis.generated).toMatchObject({
      bsonType: 'object',
      properties: {
        profile: { bsonType: 'object', properties: { name: { bsonType: 'string' } } },
        tags: { bsonType: 'array' }
      }
    })
  })

  it('returns an editable empty object Schema for an empty collection', async () => {
    await db.createCollection('empty')
    const analysis = await analyzeCollectionSchemaOnDb(db, 'empty', 30_000)
    expect(analysis).toMatchObject({
      sampleSize: 0,
      fields: [],
      generated: { bsonType: 'object', properties: {} }
    })
  })

  it('honors a smaller requested sample size', async () => {
    await db.collection('small').insertMany(Array.from({ length: 10 }, (_, index) => ({ index })))
    expect((await analyzeCollectionSchemaOnDb(db, 'small', 30_000, 3)).sampleSize).toBe(3)
  })
})
