/**
 * Native plain-`.bson` codec: round-trip, framing safety (truncated / bogus
 * length must throw, not silently drop), gzip auto-detection, and numeric
 * BSON-subtype fidelity. Pure (only bson + zlib), no live connection.
 */
import { describe, it, expect } from 'vitest'
import { ObjectId, Int32, Long } from 'bson'
import {
  parseBsonDocs,
  encodeBsonDoc,
  encodeBsonDocs,
  decodeBsonFile,
  gzipBson,
  isGzip
} from '../../../src/main/io/bsonFileCore'

describe('bsonFileCore', () => {
  it('round-trips a sequence of documents', () => {
    const id = new ObjectId()
    const docs = [
      { _id: id, name: 'alice', n: 1 },
      { _id: new ObjectId(), tags: ['a', 'b'], nested: { k: true } }
    ]
    const parsed = parseBsonDocs(encodeBsonDocs(docs))
    expect(parsed).toHaveLength(2)
    expect((parsed[0]._id as ObjectId).equals(id)).toBe(true)
    expect(parsed[0].name).toBe('alice')
    expect(Number(parsed[0].n)).toBe(1)
    expect(parsed[1].tags).toEqual(['a', 'b'])
    expect(parsed[1].nested).toEqual({ k: true })
  })

  it('preserves numeric BSON subtypes (promoteValues:false)', () => {
    const parsed = parseBsonDocs(encodeBsonDocs([{ i: new Int32(7), l: Long.fromNumber(8) }]))
    expect((parsed[0].i as Int32)._bsontype).toBe('Int32')
    expect((parsed[0].l as Long)._bsontype).toBe('Long')
  })

  it('parses an empty buffer as zero documents', () => {
    expect(parseBsonDocs(Buffer.alloc(0))).toEqual([])
    expect(encodeBsonDocs([])).toHaveLength(0)
  })

  it('throws on a truncated stream instead of dropping data', () => {
    const buf = encodeBsonDocs([{ a: 1 }, { b: 2 }])
    expect(() => parseBsonDocs(buf.subarray(0, buf.length - 3))).toThrow()
  })

  it('throws on a bogus length prefix', () => {
    // int32-LE 0x7fffffff ≫ buffer size → invalid framing.
    const buf = Buffer.from([0xff, 0xff, 0xff, 0x7f, 0x00])
    expect(() => parseBsonDocs(buf)).toThrow(/invalid bson length/i)
  })

  it('auto-detects and transparently gunzips .bson.gz', () => {
    const plain = encodeBsonDocs([{ _id: 1, hi: 'there' }])
    const gz = gzipBson(plain)
    expect(isGzip(gz)).toBe(true)
    expect(isGzip(plain)).toBe(false)
    expect(decodeBsonFile(gz)[0].hi).toBe('there')
    expect(decodeBsonFile(plain)[0].hi).toBe('there')
  })

  it('reads a buffer written by raw BSON.serialize (mongodump interop)', () => {
    const buf = Buffer.concat([encodeBsonDoc({ x: 1 }), encodeBsonDoc({ y: 2 })])
    expect(parseBsonDocs(buf)).toHaveLength(2)
  })
})
