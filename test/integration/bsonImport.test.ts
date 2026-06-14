/**
 * Native BSON import data path against a real MongoDB: documents encoded to a
 * plain `.bson` file on disk (and a gzipped `.bson.gz`) decode + insert back
 * losslessly, preserving _id and BSON types — the same fidelity concern as
 * docOps. Exercises the real file round-trip (writeFileSync → readFileSync →
 * decodeBsonFile → insertMany), which is what importBson does after the dialog.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ObjectId, Int32, Long, Decimal128, Binary } from 'bson'
import type { Db, Document } from 'mongodb'
import { encodeBsonDocs, gzipBson, decodeBsonFile } from '../../src/main/io/bsonFileCore'
import { startMongo, type MongoHarness } from '../helpers/mongo'

let harness: MongoHarness
let db: Db

beforeAll(async () => {
  harness = await startMongo()
  db = harness.client.db('bsonimport')
}, 120_000)

afterAll(async () => {
  await harness?.stop()
})

beforeEach(async () => {
  await db.dropDatabase()
})

function sample(): Document[] {
  return [
    {
      _id: new ObjectId(),
      s: 'hello',
      i: new Int32(42),
      l: Long.fromString('9007199254740993'), // > 2^53, would lose precision as a JS number
      d: new Date('2020-01-02T03:04:05.000Z'),
      dec: Decimal128.fromString('3.14'),
      bin: new Binary(Buffer.from('xyz')),
      arr: [1, 2, 3],
      nested: { a: { b: 'c' } }
    },
    { _id: 'string-id', n: 0 }
  ]
}

describe('native BSON import', () => {
  it('round-trips a plain .bson file (decode + insert) preserving types', async () => {
    const docs = sample()
    const oid = docs[0]._id as ObjectId
    const file = join(tmpdir(), `amdm-${process.pid}-plain.bson`)
    writeFileSync(file, encodeBsonDocs(docs))
    try {
      const decoded = decodeBsonFile(readFileSync(file))
      expect(decoded).toHaveLength(2)
      await db.collection('c').insertMany(decoded)
    } finally {
      rmSync(file, { force: true })
    }

    expect(await db.collection('c').countDocuments()).toBe(2)
    // Read back without promotion so 64-bit / typed values keep their fidelity.
    const back = await db
      .collection('c')
      .findOne({ _id: oid }, { promoteValues: false, promoteLongs: false, promoteBuffers: false })
    expect(back?.s).toBe('hello')
    expect((back?.i as Int32)._bsontype).toBe('Int32')
    expect((back?.l as Long).toString()).toBe('9007199254740993')
    expect((back?.dec as Decimal128).toString()).toBe('3.14')
    expect(Buffer.from((back?.bin as Binary).buffer).toString()).toBe('xyz')
    expect(back?.d).toBeInstanceOf(Date)
    expect((back?.arr as unknown[]).map(Number)).toEqual([1, 2, 3])
    expect(back?.nested).toEqual({ a: { b: 'c' } })
    expect(await db.collection('c').findOne({ _id: 'string-id' })).toMatchObject({ n: 0 })
  })

  it('reads a gzipped .bson.gz file transparently', async () => {
    const docs = sample()
    const file = join(tmpdir(), `amdm-${process.pid}-gz.bson.gz`)
    writeFileSync(file, gzipBson(encodeBsonDocs(docs)))
    try {
      await db.collection('g').insertMany(decodeBsonFile(readFileSync(file)))
    } finally {
      rmSync(file, { force: true })
    }
    expect(await db.collection('g').countDocuments()).toBe(2)
  })
})
