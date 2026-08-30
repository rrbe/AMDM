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
  tableCellCopyText,
  toPlainKeyValue,
  formatJsonPreview,
  formatTextPreview,
  toEncodedJsonArray,
  toEncodedJsonLines,
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

describe('tableCellCopyText', () => {
  const docs = [{ name: 'AMDM', count: { $numberInt: '7' } }]

  it('copies only the focused cell value', () => {
    expect(tableCellCopyText(docs, { row: 0, col: 'name' })).toBe('AMDM')
    expect(tableCellCopyText(docs, { row: 0, col: 'count' })).toBe('7')
  })

  it('defers copy when no cell is focused', () => {
    expect(tableCellCopyText(docs, null)).toBeNull()
  })
})

describe('toPlainKeyValue', () => {
  it('copies a JSON field fragment with a plain EJSON value', () => {
    expect(toPlainKeyValue('id', { $oid: OID })).toBe(`"id": "${OID}"`)
    expect(toPlainKeyValue('nested', { a: 1 })).toBe('"nested": {\n  "a": 1\n}')
  })
})

describe('bounded tooltip previews', () => {
  it('pretty-prints ordinary and extended JSON values', () => {
    expect(formatJsonPreview([{ country: 'US', zipCode: '90220' }])).toEqual({
      text: '[\n  {\n    "country": "US",\n    "zipCode": "90220"\n  }\n]',
      truncated: false
    })
    expect(formatJsonPreview({ id: { $oid: OID }, count: { $numberInt: '3' } })).toEqual({
      text: `{\n  "id": "${OID}",\n  "count": 3\n}`,
      truncated: false
    })
  })

  it('bounds JSON by lines, characters, depth, and Unicode-safe string length', () => {
    const preview = formatJsonPreview(
      {
        message: '😀'.repeat(200),
        nested: { one: { two: { three: { four: true } } } },
        items: Array.from({ length: 80 }, (_, index) => ({ index }))
      },
      { maxChars: 240, maxLines: 10, maxDepth: 3, maxStringChars: 20 }
    )

    expect(preview.truncated).toBe(true)
    expect(preview.text.split('\n').length).toBeLessThanOrEqual(10)
    expect(Array.from(preview.text).length).toBeLessThanOrEqual(240)
    expect(preview.text.endsWith('\n…')).toBe(true)
    expect(preview.text).not.toContain('\uFFFD')
    expect(() => JSON.parse(preview.text.slice(0, -2))).not.toThrow()
  })

  it('preserves text indentation and tabs while bounding lines and characters', () => {
    expect(formatTextPreview('db.items.find({\r\n\tactive: true\r\n})')).toEqual({
      text: 'db.items.find({\n\tactive: true\n})',
      truncated: false
    })

    const preview = formatTextPreview('line 1\nline 2\nline 3\nline 4', { maxChars: 20, maxLines: 3 })
    expect(preview).toEqual({ text: 'line 1\nline 2\n…', truncated: true })
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

describe('JSON Array / JSONL encoding', () => {
  const documents = [{ _id: { $oid: OID }, n: { $numberInt: '5' } }]

  it('writes Plain JSON without EJSON wrappers', () => {
    expect(toEncodedJsonArray(documents, 'plain')).toBe(`[\n  {\n    "_id": "${OID}",\n    "n": 5\n  }\n]`)
  })

  it('writes Relaxed EJSON with readable numeric values', () => {
    expect(toEncodedJsonLines(documents, 'relaxed')).toBe(`{"_id":{"$oid":"${OID}"},"n":5}`)
  })

  it('writes Canonical EJSON with exact numeric wrappers', () => {
    expect(toEncodedJsonLines(documents, 'canonical')).toBe(`{"_id":{"$oid":"${OID}"},"n":{"$numberInt":"5"}}`)
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
  it('uses the same configurable field order as the table', () => {
    const docs = [{ b: 1, a: 2 }]
    expect(toCsv(docs)).toBe('a,b\n2,1')
    expect(toCsv(docs, 'natural')).toBe('b,a\n1,2')
  })
  it('renders an ObjectId cell as its hex and an array cell as compact JSON', () => {
    expect(toCsv([{ id: { $oid: OID }, tags: [1, 2] }])).toBe(`id,tags\n${OID},"[1,2]"`)
  })
  it('preserves literal dotted fields and quotes carriage returns', () => {
    expect(toCsv([{ 'a.b': 'x\ry' }])).toBe('a.b\n"x\ry"')
  })
})
