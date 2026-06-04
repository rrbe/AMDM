/**
 * Column derivation + cell extraction shared by the Table view and CSV/TSV.
 */
import { describe, it, expect } from 'vitest'
import { deriveColumns, cellValue } from '@renderer/lib/tableShape'

const OID = '64b7f0f0f0f0f0f0f0f0f0f0'

describe('deriveColumns', () => {
  it('unions top-level fields in first-seen order', () => {
    expect(deriveColumns([{ b: 1 }, { a: 2 }, { b: 3, c: 4 }])).toEqual(['b', 'a', 'c'])
  })
  it('flattens nested plain objects ONE level', () => {
    expect(deriveColumns([{ address: { city: 'x', zip: '1' } }])).toEqual(['address.city', 'address.zip'])
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
  it('treats a present null as present', () => {
    expect(cellValue({ a: null }, 'a')).toEqual({ present: true, value: null })
  })
  it('reports a missing top-level field', () => {
    expect(cellValue({ a: 1 }, 'b')).toEqual({ present: false, value: undefined })
  })
  it('navigates one dot level', () => {
    expect(cellValue({ address: { city: 'x' } }, 'address.city')).toEqual({ present: true, value: 'x' })
  })
  it('reports a missing nested field', () => {
    expect(cellValue({ address: { city: 'x' } }, 'address.zip')).toEqual({
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
