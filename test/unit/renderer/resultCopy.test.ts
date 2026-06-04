/**
 * Clipboard serialization — plain/shell/strict formats and CSV/TSV tables.
 */
import { describe, it, expect } from 'vitest'
import {
  toPlainValue,
  toPlainJson,
  toShellText,
  toStrictEjson,
  plainScalarText,
  toCsv,
  toTsv
} from '@renderer/lib/resultCopy'

const OID = '64b7f0f0f0f0f0f0f0f0f0f0'

describe('toPlainValue collapses EJSON to ordinary JSON', () => {
  it('recurses into arrays and nested objects', () => {
    expect(toPlainValue({ a: [{ $oid: OID }, 2], b: { c: { $numberInt: '3' } } })).toEqual({
      a: [OID, 2],
      b: { c: 3 }
    })
  })
  it('$undefined collapses to null', () => {
    expect(toPlainValue({ $undefined: true })).toBeNull()
  })
  it('Code with a scope keeps both parts', () => {
    expect(toPlainValue({ $code: 'fn', $scope: { x: { $numberInt: '1' } } })).toEqual({
      code: 'fn',
      scope: { x: 1 }
    })
  })
  it('DBRef with a $db is preserved', () => {
    expect(toPlainValue({ $ref: 'c', $id: { $oid: OID }, $db: 'd' })).toEqual({
      $ref: 'c',
      $id: OID,
      $db: 'd'
    })
  })
})

describe('plainScalarText', () => {
  it('renders scalars bare, null as "null", objects as pretty JSON', () => {
    expect(plainScalarText('hello')).toBe('hello')
    expect(plainScalarText({ $oid: OID })).toBe(OID)
    expect(plainScalarText({ $numberInt: '7' })).toBe('7')
    expect(plainScalarText(true)).toBe('true')
    expect(plainScalarText({ $undefined: true })).toBe('null')
    expect(plainScalarText({ a: 1 })).toBe('{\n  "a": 1\n}')
  })
})

describe('toPlainJson / toStrictEjson / toShellText', () => {
  const doc = { _id: { $oid: OID }, n: { $numberInt: '5' } }
  it('toPlainJson pretty-prints the collapsed value', () => {
    expect(toPlainJson(doc)).toBe(`{\n  "_id": "${OID}",\n  "n": 5\n}`)
  })
  it('toStrictEjson keeps the canonical wrappers as-is', () => {
    expect(toStrictEjson(doc)).toBe(JSON.stringify(doc, null, 2))
  })
  it('toShellText renders shell-style scalars', () => {
    expect(toShellText(doc)).toBe(`{\n  "_id": ObjectId("${OID}"),\n  "n": 5\n}`)
  })
})

describe('CSV / TSV (RFC-4180 quoting)', () => {
  const docs = [
    { a: 1, b: 'x,y' },
    { a: 2, b: 'has "quote"' },
    { a: 3, b: 'line\nbreak' }
  ]
  it('quotes fields containing the delimiter, a quote, or a newline', () => {
    expect(toCsv(docs)).toBe('a,b\n1,"x,y"\n2,"has ""quote"""\n3,"line\nbreak"')
  })
  it('TSV uses tabs and does not quote a comma-bearing field', () => {
    expect(toTsv([{ a: 'x,y' }])).toBe('a\nx,y')
  })
  it('derives a header from the union of columns; missing cells are empty', () => {
    expect(toCsv([{ a: 1 }, { b: 2 }])).toBe('a,b\n1,\n,2')
  })
  it('renders an ObjectId cell as its hex and an array cell as compact JSON', () => {
    expect(toCsv([{ id: { $oid: OID }, tags: [1, 2] }])).toBe(`id,tags\n${OID},"[1,2]"`)
  })
})
