/**
 * Native BSON export streaming path against a real MongoDB. The unit tests cover
 * the codec and the import side covers decode+insert; this exercises the part
 * that's easiest to get wrong — the streaming writer itself (cursor → optional
 * gzip pipe → file, with flush timing) — end to end, by writing a temp file from
 * a live cursor and decoding it back.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ObjectId, Int32 } from 'bson'
import type { Db, Document } from 'mongodb'
import { streamBsonToFile } from '../../src/main/io/bsonWriteCore'
import { decodeBsonFile, isGzip } from '../../src/main/io/bsonFileCore'
import { startMongo, type MongoHarness } from '../helpers/mongo'

let harness: MongoHarness
let db: Db

beforeAll(async () => {
  harness = await startMongo()
  db = harness.client.db('bsonexport')
}, 120_000)

afterAll(async () => {
  await harness?.stop()
})

beforeEach(async () => {
  await db.dropDatabase()
})

function seed(): Document[] {
  return [
    { _id: new ObjectId(), s: 'a', i: new Int32(1) },
    { _id: 'string-id', s: 'b', nested: { k: true } },
    { _id: new ObjectId(), s: 'c', arr: [1, 2, 3] }
  ]
}

describe('native BSON export (streamBsonToFile)', () => {
  it('streams a plain .bson file that round-trips', async () => {
    await db.collection('c').insertMany(seed())
    const file = join(tmpdir(), `amdm-${process.pid}-export.bson`)
    try {
      const count = await streamBsonToFile(db.collection('c').find(), file, false)
      expect(count).toBe(3)
      const bytes = readFileSync(file)
      expect(isGzip(bytes)).toBe(false)
      const back = decodeBsonFile(bytes)
      expect(back).toHaveLength(3)
      expect(back.map((d) => d.s).sort()).toEqual(['a', 'b', 'c'])
    } finally {
      rmSync(file, { force: true })
    }
  })

  it('streams a gzipped .bson.gz that round-trips', async () => {
    await db.collection('c').insertMany(seed())
    const file = join(tmpdir(), `amdm-${process.pid}-export.bson.gz`)
    try {
      const count = await streamBsonToFile(db.collection('c').find(), file, true)
      expect(count).toBe(3)
      const bytes = readFileSync(file)
      expect(isGzip(bytes)).toBe(true) // really gzip-compressed on disk
      expect(decodeBsonFile(bytes)).toHaveLength(3) // and transparently decodes
    } finally {
      rmSync(file, { force: true })
    }
  })

  it('respects an empty result (writes a zero-document file)', async () => {
    const file = join(tmpdir(), `amdm-${process.pid}-empty.bson`)
    try {
      const count = await streamBsonToFile(db.collection('c').find(), file, false)
      expect(count).toBe(0)
      expect(decodeBsonFile(readFileSync(file))).toEqual([])
    } finally {
      rmSync(file, { force: true })
    }
  })
})
