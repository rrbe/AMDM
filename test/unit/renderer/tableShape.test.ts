/**
 * Column derivation + cell extraction shared by the Table view and CSV/TSV.
 */
import { describe, it, expect } from 'vitest'
import { deriveColumns, cellValue, sortTableRows, type TableSortState } from '@renderer/lib/tableShape'

const OID = '64b7f0f0f0f0f0f0f0f0f0f0'

describe('deriveColumns', () => {
  it('sorts the union of top-level fields alphabetically by default', () => {
    expect(deriveColumns([{ b: 1 }, { a: 2 }, { b: 3, c: 4 }])).toEqual(['a', 'b', 'c'])
  })
  it('keeps the union of top-level fields in first-seen order when requested', () => {
    expect(deriveColumns([{ b: 1 }, { a: 2 }, { b: 3, c: 4 }], 'natural')).toEqual([
      'b',
      'a',
      'c'
    ])
  })
  it('keeps nested plain objects as a single column', () => {
    expect(deriveColumns([{ address: { city: 'x', zip: '1' } }])).toEqual(['address'])
  })
  it('does NOT flatten EJSON wrappers (they are scalar leaves)', () => {
    expect(deriveColumns([{ id: { $oid: OID } }])).toEqual(['id'])
  })
  it('keeps an empty nested object as the field itself', () => {
    expect(deriveColumns([{ address: {} }])).toEqual(['address'])
  })
  it('does not flatten arrays', () => {
    expect(deriveColumns([{ tags: [1, 2] }])).toEqual(['tags'])
  })
  it('yields (value) when every doc is a non-object', () => {
    expect(deriveColumns([1, 2, 3])).toEqual(['(value)'])
  })
  it('ignores stray non-object docs when object columns exist', () => {
    expect(deriveColumns([{ a: 1 }, 5])).toEqual(['a'])
  })
})

describe('cellValue', () => {
  it('reads a top-level field', () => {
    expect(cellValue({ a: 1 }, 'a')).toEqual({ present: true, value: 1 })
  })
  it('prefers a literal dotted field over nested-path lookup', () => {
    expect(cellValue({ 'a.b': 1, a: { b: 2 } }, 'a.b')).toEqual({ present: true, value: 1 })
  })
  it('treats a present null as present', () => {
    expect(cellValue({ a: null }, 'a')).toEqual({ present: true, value: null })
  })
  it('reports a missing top-level field', () => {
    expect(cellValue({ a: 1 }, 'b')).toEqual({ present: false, value: undefined })
  })
  it('does not navigate into a nested object', () => {
    expect(cellValue({ address: { city: 'x' } }, 'address.city')).toEqual({
      present: false,
      value: undefined
    })
  })
  it('does not descend into an EJSON wrapper parent', () => {
    expect(cellValue({ id: { $oid: OID } }, 'id.$oid')).toEqual({ present: false, value: undefined })
  })
  it('returns the scalar itself for the (value) column', () => {
    expect(cellValue(5, '(value)')).toEqual({ present: true, value: 5 })
    expect(cellValue(5, 'x')).toEqual({ present: false, value: undefined })
  })
})

describe('sortTableRows', () => {
  const values = (docs: unknown[], sort: TableSortState): unknown[] =>
    sortTableRows(docs, sort, 'en').map((row) => cellValue(row.doc, sort.column).value)

  it('returns source-indexed rows without mutating the query result', () => {
    const docs = [{ n: 2 }, { n: 1 }]
    expect(sortTableRows(docs, null)).toEqual([
      { doc: docs[0], sourceIndex: 0 },
      { doc: docs[1], sourceIndex: 1 }
    ])
    expect(values(docs, { column: 'n', direction: 'asc' })).toEqual([1, 2])
    expect(docs).toEqual([{ n: 2 }, { n: 1 }])
  })

  it('sorts numbers numerically in both directions', () => {
    const docs = [{ n: 10 }, { n: 2 }, { n: -3 }]
    expect(values(docs, { column: 'n', direction: 'asc' })).toEqual([-3, 2, 10])
    expect(values(docs, { column: 'n', direction: 'desc' })).toEqual([10, 2, -3])
  })

  it('compares large integers and decimals without losing precision', () => {
    const docs = [
      { n: { $numberLong: '9007199254740993' } },
      { n: { $numberLong: '9007199254740992' } },
      { n: { $numberDecimal: '9007199254740992.5' } },
      { n: { $numberDecimal: '-0.0001' } }
    ]
    expect(values(docs, { column: 'n', direction: 'asc' })).toEqual([
      { $numberDecimal: '-0.0001' },
      { $numberLong: '9007199254740992' },
      { $numberDecimal: '9007199254740992.5' },
      { $numberLong: '9007199254740993' }
    ])
  })

  it('sorts canonical dates chronologically', () => {
    const docs = [
      { at: { $date: '2026-02-01T00:00:00.000Z' } },
      { at: { $date: { $numberLong: '0' } } },
      { at: { $date: '2025-12-31T23:59:59.000Z' } }
    ]
    expect(values(docs, { column: 'at', direction: 'asc' })).toEqual([
      { $date: { $numberLong: '0' } },
      { $date: '2025-12-31T23:59:59.000Z' },
      { $date: '2026-02-01T00:00:00.000Z' }
    ])
  })

  it('uses natural text ordering and keeps equivalent values stable', () => {
    const docs = [{ name: 'item10' }, { name: 'Item2' }, { name: 'item2' }]
    expect(sortTableRows(docs, { column: 'name', direction: 'asc' }, 'en').map((row) => row.sourceIndex)).toEqual([
      1, 2, 0
    ])
  })

  it('orders ObjectIds, booleans, arrays, and objects deterministically', () => {
    const docs = [
      { value: { b: 1, a: 2 } },
      { value: [2] },
      { value: true },
      { value: false },
      { value: { $oid: '000000000000000000000002' } },
      { value: { $oid: '000000000000000000000001' } },
      { value: { a: 2, b: 1 } }
    ]
    expect(sortTableRows(docs, { column: 'value', direction: 'asc' }, 'en').map((row) => row.sourceIndex)).toEqual([
      5, 4, 3, 2, 1, 0, 6
    ])
  })

  it('orders ObjectIds by hexadecimal value instead of numeric collation segments', () => {
    const docs = [
      { id: { $oid: '2fffffffffffffffffffffff' } },
      { id: { $oid: '100000000000000000000000' } }
    ]
    expect(sortTableRows(docs, { column: 'id', direction: 'asc' }, 'en').map((row) => row.sourceIndex)).toEqual([
      1, 0
    ])
  })

  it('orders BSON Timestamps by time and then increment', () => {
    const docs = [
      { ts: { $timestamp: { t: 10, i: 1 } } },
      { ts: { $timestamp: { t: 9, i: 1 } } },
      { ts: { $timestamp: { t: 10, i: 0 } } }
    ]
    expect(sortTableRows(docs, { column: 'ts', direction: 'asc' }, 'en').map((row) => row.sourceIndex)).toEqual([
      1, 2, 0
    ])
    expect(sortTableRows(docs, { column: 'ts', direction: 'desc' }, 'en').map((row) => row.sourceIndex)).toEqual([
      0, 2, 1
    ])
  })

  it('uses shallow bounded keys for nested containers', () => {
    const deepValue = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error('nested value was traversed')
        }
      }
    )
    const docs = [
      { value: [deepValue, deepValue] },
      { value: [deepValue] },
      { value: { first: deepValue, second: deepValue } },
      { value: { first: deepValue } }
    ]
    expect(sortTableRows(docs, { column: 'value', direction: 'asc' }, 'en').map((row) => row.sourceIndex)).toEqual([
      1, 0, 3, 2
    ])
  })

  it('keeps null, undefined, canonical undefined, and missing fields last in both directions', () => {
    const docs = [{ n: null }, { n: 2 }, {}, { n: { $undefined: true } }, { n: 1 }, { n: undefined }]
    expect(sortTableRows(docs, { column: 'n', direction: 'asc' }, 'en').map((row) => row.sourceIndex)).toEqual([
      4, 1, 0, 2, 3, 5
    ])
    expect(sortTableRows(docs, { column: 'n', direction: 'desc' }, 'en').map((row) => row.sourceIndex)).toEqual([
      1, 4, 0, 2, 3, 5
    ])
  })

  it('sorts mixed non-empty types by a fixed type order and preserves ties', () => {
    const docs = [
      { value: true },
      { value: 'a' },
      { value: { $date: '2026-01-01T00:00:00.000Z' } },
      { value: 1 },
      { value: 1 }
    ]
    expect(sortTableRows(docs, { column: 'value', direction: 'asc' }, 'en').map((row) => row.sourceIndex)).toEqual([
      3, 4, 2, 1, 0
    ])
  })
})
