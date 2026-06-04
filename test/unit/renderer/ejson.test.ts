/**
 * EJSON display helpers — the single place that understands the canonical wire
 * shape and decides display string, type tag, and expandability for all views.
 */
import { describe, it, expect } from 'vitest'
import {
  isExtended,
  formatScalar,
  valueType,
  typeLabel,
  isExpandable,
  entriesOf,
  summarize
} from '@renderer/lib/ejson'
import { SCALAR_CASES } from '../../fixtures/bson-corpus'

const OID = '64b7f0f0f0f0f0f0f0f0f0f0'
// The wrapper-object cases (exclude bare primitives string/boolean/null).
const WRAPPERS = SCALAR_CASES.filter((c) => typeof c.ejson === 'object' && c.ejson !== null)

describe('corpus: every BSON wrapper is a recognized, non-expandable leaf', () => {
  for (const c of WRAPPERS) {
    it(c.name, () => {
      expect(isExtended(c.ejson)).toBe(true)
      expect(isExpandable(c.ejson)).toBe(false)
      expect(valueType(c.ejson)).toBe(c.type)
      expect(formatScalar(c.ejson)).toEqual({ text: c.display, type: c.type })
      // A leaf node summarizes as its scalar display string.
      expect(summarize(c.ejson)).toBe(c.display)
      // Leaves yield no children.
      expect(entriesOf(c.ejson)).toEqual([])
    })
  }
})

describe('isExtended', () => {
  it('rejects plain objects, empty objects, arrays, and primitives', () => {
    expect(isExtended({ oid: 'x' })).toBe(false) // no $-marker
    expect(isExtended({})).toBe(false)
    expect(isExtended([1, 2])).toBe(false)
    expect(isExtended('s')).toBe(false)
    expect(isExtended(5)).toBe(false)
    expect(isExtended(null)).toBe(false)
  })
  it('accepts legacy binary form { $binary, $type } and { $undefined }', () => {
    expect(isExtended({ $binary: 'aGk=', $type: '00' })).toBe(true)
    expect(isExtended({ $undefined: true })).toBe(true)
  })
  it('accepts bare Code (single-key $code) — regression for the leaf/expandable bug', () => {
    expect(isExtended({ $code: 'x=1' })).toBe(true)
    expect(isExpandable({ $code: 'x=1' })).toBe(false)
    expect(valueType({ $code: 'x=1' })).toBe('code')
  })
})

describe('formatScalar edge cases', () => {
  it('renders $date from a string or numeric payload', () => {
    expect(formatScalar({ $date: '2024-01-02T03:04:05.000Z' }).text).toBe(
      'ISODate("2024-01-02T03:04:05.000Z")'
    )
    expect(formatScalar({ $date: 1704164645000 }).text).toBe('ISODate("2024-01-02T03:04:05.000Z")')
  })
  it('a number wrapper with extra keys is NOT a number — falls back to object', () => {
    const s = formatScalar({ $numberLong: '5', extra: 1 })
    expect(s.type).toBe('object')
    expect(s.text).toBe('Object {2}')
  })
  it('keeps non-finite doubles as their canonical token string', () => {
    expect(formatScalar({ $numberDouble: 'Infinity' })).toEqual({ text: 'Infinity', type: 'double' })
    expect(formatScalar({ $numberDouble: 'NaN' })).toEqual({ text: 'NaN', type: 'double' })
  })
  it('reads subType from legacy { $binary, $type }', () => {
    expect(formatScalar({ $binary: 'aGk=', $type: '80' }).text).toBe('BinData(80, …)')
  })
  it('handles plain JSON primitives', () => {
    expect(formatScalar('hi')).toEqual({ text: 'hi', type: 'string' })
    expect(formatScalar(42)).toEqual({ text: '42', type: 'number' })
    expect(formatScalar(true)).toEqual({ text: 'true', type: 'boolean' })
    expect(formatScalar(null)).toEqual({ text: 'null', type: 'null' })
    expect(formatScalar([1, 2, 3])).toEqual({ text: 'Array(3)', type: 'array' })
  })
})

describe('valueType / typeLabel', () => {
  it('classifies containers and primitives', () => {
    expect(valueType([1])).toBe('array')
    expect(valueType({ a: 1 })).toBe('object')
    expect(valueType(1n)).toBe('long')
  })
  it('maps types to shell/Compass labels', () => {
    expect(typeLabel({ $oid: OID })).toBe('ObjectId')
    expect(typeLabel({ $numberInt: '1' })).toBe('Int32')
    expect(typeLabel({ $numberLong: '1' })).toBe('Int64')
    expect(typeLabel([1])).toBe('Array')
    expect(typeLabel({ a: 1 })).toBe('Object')
  })
})

describe('isExpandable / entriesOf / summarize on containers', () => {
  it('non-empty arrays and objects are expandable; empty ones are not', () => {
    expect(isExpandable([1])).toBe(true)
    expect(isExpandable([])).toBe(false)
    expect(isExpandable({ a: 1 })).toBe(true)
    expect(isExpandable({})).toBe(false)
  })
  it('entriesOf yields indexed entries for arrays and pairs for objects', () => {
    expect(entriesOf([10, 20])).toEqual([
      ['0', 10],
      ['1', 20]
    ])
    expect(entriesOf({ a: 1, b: 2 })).toEqual([
      ['a', 1],
      ['b', 2]
    ])
  })
  it('summarize gives a one-line count for collapsed containers', () => {
    expect(summarize([1, 2, 3])).toBe('[ 3 ]')
    expect(summarize({ a: 1, b: 2 })).toBe('{ 2 fields }')
  })
})
