/**
 * Pure serialization/extraction shared by the worker and inline fallback.
 * (serializeValue's per-type output is pinned by the contract suite; here we
 * cover field extraction and a couple of structural cases.)
 */
import { describe, it, expect } from 'vitest'
import { ObjectId } from 'bson'
import { serializeValue, extractFieldPaths } from '../../../src/main/workers/serialize-core'

describe('serializeValue', () => {
  it('serializes a nested document to EJSON-canonical', () => {
    expect(serializeValue({ _id: new ObjectId('64b7f0f0f0f0f0f0f0f0f0f0'), a: [1, 2] })).toEqual({
      _id: { $oid: '64b7f0f0f0f0f0f0f0f0f0f0' },
      a: [{ $numberInt: '1' }, { $numberInt: '2' }]
    })
  })
})

describe('extractFieldPaths', () => {
  it('collects top-level fields, sorted', () => {
    expect(extractFieldPaths([{ b: 1, a: 2 }])).toEqual(['a', 'b'])
  })
  it('unions fields across documents', () => {
    expect(extractFieldPaths([{ a: 1 }, { b: 2 }, { a: 3, c: 4 }])).toEqual(['a', 'b', 'c'])
  })
  it('descends at most two levels into nested plain objects', () => {
    // names collected: a, a.b, a.b.c — but NOT a.b.c.d (depth cap).
    expect(extractFieldPaths([{ a: { b: { c: { d: 1 } } } }])).toEqual(['a', 'a.b', 'a.b.c'])
  })
  it('does not descend into arrays or BSON-like values', () => {
    expect(extractFieldPaths([{ tags: [{ x: 1 }], when: new Date(), id: new ObjectId() }])).toEqual([
      'id',
      'tags',
      'when'
    ])
  })
  it('skips non-object documents', () => {
    expect(extractFieldPaths([1, 'x', null, { a: 1 }])).toEqual(['a'])
  })
  it('caps the number of fields at 500', () => {
    const wide: Record<string, number> = {}
    for (let i = 0; i < 600; i++) wide[`f${i}`] = i
    expect(extractFieldPaths([wide])).toHaveLength(500)
  })
})
