import { describe, expect, it } from 'vitest'
import { gridColumnCount, gridFields } from '@renderer/lib/gridLayout'

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
    expect(gridFields(doc, null, 'alphaAsc', false)).toEqual(['_id', 'a', 'z'])
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
