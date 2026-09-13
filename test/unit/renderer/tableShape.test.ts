/**
 * Column derivation + cell extraction shared by the Table view and CSV/TSV.
 */
import { describe, it, expect } from 'vitest'
import {
  deriveColumns,
  deriveTableColumnGroups,
  cellValue,
  orderTableColumns,
  sortTableRows,
  type TableSortState
} from '@renderer/lib/tableShape'

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

describe('orderTableColumns', () => {
  it('uses the configured field order until columns are manually arranged', () => {
    const columns = ['name', '_id']
    expect(orderTableColumns(columns, [])).toBe(columns)
  })

  it('keeps arranged fields in place and appends new fields in their derived order', () => {
    expect(orderTableColumns(['_id', 'age', 'name', 'status'], ['name', '_id'])).toEqual([
      'name',
      '_id',
      'age',
      'status'
    ])
  })

  it('remembers missing fields across sparse and empty results', () => {
    const order = ['name', 'age', '_id']
    expect(orderTableColumns(['_id', 'name'], order)).toEqual(['name', '_id'])
    expect(orderTableColumns([], order)).toEqual([])
    expect(orderTableColumns(['_id', 'age', 'name'], order)).toEqual(['name', 'age', '_id'])
    expect(order).toEqual(['name', 'age', '_id'])
  })
})

describe('deriveTableColumnGroups', () => {
  const docs = [
    { orderNo: 1001, notified: { shipped: false, transit: true }, tags: ['new'], id: { $oid: OID } },
    { orderNo: 1002, notified: { delivered: false, details: { attempts: 2 } }, tags: [], id: { $oid: OID } }
  ]

  it('keeps one column per top-level field in inline mode', () => {
    const groups = deriveTableColumnGroups(docs, 'inline', 'natural')
    expect(groups.map((group) => group.key)).toEqual(['orderNo', 'notified', 'tags', 'id'])
    expect(groups.map((group) => group.columns.map((column) => column.path))).toEqual([
      [['orderNo']],
      [['notified']],
      [['tags']],
      [['id']]
    ])
  })

  it('unions one level of object fields while retaining arrays and BSON scalars', () => {
    const groups = deriveTableColumnGroups(docs, 'grouped', 'natural')
    expect(groups[1].columns.map((column) => column.path)).toEqual([
      ['notified', 'shipped'],
      ['notified', 'transit'],
      ['notified', 'delivered'],
      ['notified', 'details']
    ])
    expect(groups[2].columns[0].path).toEqual(['tags'])
    expect(groups[3].columns[0].path).toEqual(['id'])
    expect(cellValue(docs[1], groups[1].columns[3].path).value).toEqual({ attempts: 2 })
  })

  it('applies alphabetical ordering to both header levels', () => {
    const groups = deriveTableColumnGroups(docs, 'grouped', 'alpha')
    expect(groups.map((group) => group.key)).toEqual(['id', 'notified', 'orderNo', 'tags'])
    expect(groups[1].columns.map((column) => column.label)).toEqual(['delivered', 'details', 'shipped', 'transit'])
  })

  it('retains mixed-type and empty fields without discarding their values', () => {
    for (const mixed of [null, 'pending', false, [], { $numberInt: '2' }]) {
      const group = deriveTableColumnGroups([{ field: { a: 1 } }, { field: mixed }], 'grouped')[0]
      expect(group.columns.map((column) => column.path)).toEqual([['field']])
      expect(cellValue({ field: mixed }, group.columns[0].path)).toEqual({ present: true, value: mixed })
    }
    expect(deriveTableColumnGroups([{ field: {} }], 'grouped')[0].columns[0].path).toEqual(['field'])
    const sparse = deriveTableColumnGroups([{ field: { a: 1 } }, {}], 'grouped')[0].columns[0]
    expect(cellValue({}, sparse.path).present).toBe(false)
  })

  it('auto groups up to three distinct children per field and previews wider unions', () => {
    const groups = deriveTableColumnGroups(
      [
        { small: { b: 1, a: { deep: { value: 2 } } }, wide: { a: 1, b: 2 } },
        { small: { c: 3, a: 4 }, wide: { c: 3, d: 4 } }
      ],
      'auto'
    )
    expect(groups.map((group) => group.columns.map((column) => column.path))).toEqual([
      [
        ['small', 'a'],
        ['small', 'b'],
        ['small', 'c']
      ],
      [['wide']]
    ])
    expect(
      deriveTableColumnGroups([{ field: { b: 1, a: 2 } }], 'auto', 'natural')[0].columns.map(
        (column) => column.label
      )
    ).toEqual(['b', 'a'])
  })

  it('auto stops inspecting a field after its fourth distinct child', () => {
    const later = {
      get field(): unknown {
        throw new Error('should not inspect later values')
      }
    }
    expect(
      deriveTableColumnGroups([{ field: { a: 1, b: 2, c: 3, d: 4 } }, later], 'auto')[0].columns[0].path
    ).toEqual(['field'])
  })

  it('auto preserves mixed values, empty objects, and sparse fields', () => {
    for (const value of [null, 'pending', [], { $numberInt: '2' }]) {
      expect(
        deriveTableColumnGroups([{ field: { a: 1 } }, {}, { field: value }], 'auto')[0].columns[0].path
      ).toEqual(['field'])
    }
    expect(deriveTableColumnGroups([{ field: {} }], 'auto')[0].columns[0].path).toEqual(['field'])
    expect(deriveTableColumnGroups([{ field: { a: 1 } }, {}], 'auto')[0].columns[0].path).toEqual([
      'field',
      'a'
    ])
  })

  it('distinguishes literal dotted keys from nested paths', () => {
    const doc = { 'a.b': 1, a: { b: 2, 'c.d': 3 } }
    const columns = deriveTableColumnGroups([doc], 'grouped', 'natural').flatMap((group) => group.columns)
    expect(new Set(columns.map((column) => column.id)).size).toBe(3)
    expect(columns.map((column) => cellValue(doc, column.path).value)).toEqual([1, 2, 3])
  })
})

describe('cellValue', () => {
  it('reads explicit nested paths without following inherited fields or BSON internals', () => {
    const doc = { a: { b: false, c: null }, id: { $oid: OID } }
    expect(cellValue(doc, ['a', 'b'])).toEqual({ present: true, value: false })
    expect(cellValue(doc, ['a', 'c'])).toEqual({ present: true, value: null })
    expect(cellValue(doc, ['a', 'toString']).present).toBe(false)
    expect(cellValue(doc, ['id', '$oid']).present).toBe(false)
  })
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
  it('sorts nested BSON values and preserves source indexes and missing-value order', () => {
    const docs = [{ a: { b: { $numberInt: '10' } } }, {}, { a: { b: { $numberInt: '2' } } }]
    const rows = sortTableRows(docs, { column: ['a', 'b'], direction: 'asc' })
    expect(rows.map((row) => row.sourceIndex)).toEqual([2, 0, 1])
    expect(rows[0].doc).toBe(docs[2])
  })
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
