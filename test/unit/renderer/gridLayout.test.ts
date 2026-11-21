import { describe, expect, it } from 'vitest'
import {
  gridAnchorOffset,
  gridColumnCount,
  gridFields,
  gridRowFieldCounts,
  gridRows,
  gridVisibleFieldIndexes
} from '@renderer/lib/gridLayout'
import { getResultFieldInfo } from '@renderer/lib/resultFields'

describe('Grid layout', () => {
  it('fits complete cards and gaps inside the result container', () => {
    expect([0, 300, 715, 716, 1067, 1068, 1420, 1772].map(gridColumnCount)).toEqual([1, 1, 1, 2, 2, 3, 4, 5])
  })

  it('filters only own fields, preserving document order and source data', () => {
    const doc = { z: null, _id: { $oid: '64b7f0f0f0f0f0f0f0f0f0f0' }, a: [1, 2] }
    const original = structuredClone(doc)
    expect(gridFields(doc, ['a', 'missing', 'z', 'toString'], 'natural', false)).toEqual(['z', 'a'])
    expect(gridFields(doc, [], 'natural', false)).toEqual([])
    expect(doc).toEqual(original)
  })

  it('applies field sorting and id-first without flattening nested values', () => {
    const doc = { z: { a: 1 }, _id: 1, a: [1, 2] }
    expect(gridFields(doc, null, 'natural', true)).toEqual(['_id', 'z', 'a'])
    expect(gridFields(doc, null, 'alphaDesc', true)).toEqual(['_id', 'z', 'a'])
    expect(gridFields(doc, null, 'alpha', false)).toEqual(['_id', 'a', 'z'])
  })

  it('uses the tallest document per row after filtering, including scalars and empty documents', () => {
    const { documents } = getResultFieldInfo([{ a: 1 }, { a: 1, b: 2, c: 3 }, {}, 42, { b: 2 }])
    expect(gridRowFieldCounts(documents, null, 3)).toEqual([3, 1])
    expect(gridRowFieldCounts(documents, ['b', 'missing', 'b'], 3)).toEqual([1, 1])
    expect(gridRowFieldCounts(documents, [], 3)).toEqual([1, 1])
    expect(gridRowFieldCounts(documents, null, 2)).toEqual([3, 1, 1])
  })

  it('lays out fixed rows and expanded rows without limiting their field counts', () => {
    expect(gridRows(4, 3, 13)).toEqual([
      { start: 12, size: 280 },
      { start: 292, size: 280 }
    ])
    const rows = gridRows(4, 3, 13, [3, 1000])
    expect(rows).toEqual([
      { start: 12, size: 160 },
      { start: 172, size: 24088 }
    ])
    expect(gridAnchorOffset(rows, 1, 1200)).toBe(1372)
    expect(gridAnchorOffset(gridRows(4, 3, 13), 1, 1200)).toBe(292)
    expect(gridAnchorOffset(rows, 0, -12)).toBe(0)
    expect(gridAnchorOffset([], 0, 0)).toBe(0)
  })

  it('mounts only viewport fields in a tall card and keeps its focused field', () => {
    expect(gridVisibleFieldIndexes(10000, 41, 2441, 240, 24, null)).toEqual(
      Array.from({ length: 14 }, (_, i) => i + 98)
    )
    const indexes = gridVisibleFieldIndexes(10000, 41, 2441, 240, 24, 3)
    expect(indexes).toHaveLength(15)
    expect(indexes[0]).toBe(3)
    expect(gridVisibleFieldIndexes(4, 10000, 0, 240, 24, null)).toEqual([])
    expect(gridVisibleFieldIndexes(4, 0, 10000, 240, 24, null)).toEqual([])
    expect(gridVisibleFieldIndexes(0, 0, 0, 240, 24, null)).toEqual([])
  })

  it('keeps BSON wrappers, arrays and scalar results as single values', () => {
    for (const value of [
      null,
      undefined,
      'text',
      42,
      [1, 2],
      { $oid: '64b7f0f0f0f0f0f0f0f0f0f0' },
      { $date: { $numberLong: '0' } }
    ]) {
      expect(gridFields(value, null, 'natural', true)).toBeNull()
    }
    expect(gridFields({}, null, 'natural', true)).toEqual([])
  })
})
