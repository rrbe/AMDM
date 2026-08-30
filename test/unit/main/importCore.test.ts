import { describe, expect, it } from 'vitest'
import { Int32, Long, ObjectId } from 'bson'
import { detectImportFileFormat, parseJsonDocuments } from '../../../src/main/io/importCore'

describe('import format detection', () => {
  it.each([
    ['data.json', 'json'],
    ['data.jsonl', 'json'],
    ['data.ndjson', 'json'],
    ['data.csv', 'csv'],
    ['data.tsv', 'tsv'],
    ['data.xlsx', 'xlsx'],
    ['data.bson', 'bson'],
    ['data.bson.gz', 'bson']
  ] as const)('detects %s', (filePath, format) => {
    expect(detectImportFileFormat(filePath)).toBe(format)
  })

  it('rejects unsupported extensions', () => {
    expect(() => detectImportFileFormat('data.txt')).toThrow('Unsupported import file type: .txt')
  })
})

describe('JSON import auto-detection', () => {
  it('accepts a single pretty-printed Plain JSON document', () => {
    expect(parseJsonDocuments('{\n  "name": "Ada",\n  "count": 2\n}')).toMatchObject([{ name: 'Ada' }])
  })

  it('accepts JSON Array and JSONL layouts', () => {
    expect(parseJsonDocuments('[{"name":"Ada"},{"name":"Lin"}]')).toHaveLength(2)
    expect(parseJsonDocuments('{"name":"Ada"}\n{"name":"Lin"}\n')).toHaveLength(2)
  })

  it('preserves Canonical EJSON types', () => {
    const [document] = parseJsonDocuments(
      '{"_id":{"$oid":"64b7f0f0f0f0f0f0f0f0f0f0"},"i":{"$numberInt":"7"},"l":{"$numberLong":"9007199254740993"}}'
    )
    expect(document._id).toBeInstanceOf(ObjectId)
    expect(document.i).toBeInstanceOf(Int32)
    expect(document.l).toBeInstanceOf(Long)
    expect(document.l.toString()).toBe('9007199254740993')
  })

  it('rejects non-document top-level values', () => {
    expect(() => parseJsonDocuments('42')).toThrow('JSON import requires document objects.')
    expect(() => parseJsonDocuments('{"$oid":"64b7f0f0f0f0f0f0f0f0f0f0"}')).toThrow(
      'JSON import requires document objects.'
    )
  })
})
