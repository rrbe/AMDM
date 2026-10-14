import { describe, expect, it } from 'vitest'
import {
  collectTabularColumns,
  resolveTabularDelimiter,
  sanitizeWorksheetName,
  sortTabularColumns,
  tabularSpreadsheetCell,
  tabularTextCell
} from '../../../src/shared/tabularExport'

describe('tabular export values', () => {
  it('resolves format defaults and rejects unsupported delimiters', () => {
    expect(resolveTabularDelimiter('csv')).toBe(',')
    expect(resolveTabularDelimiter('tsv')).toBe('\t')
    expect(resolveTabularDelimiter('csv', ';')).toBe(';')
    expect(() => resolveTabularDelimiter('csv', '||')).toThrow('Unsupported tabular delimiter')
  })

  it('uses top-level fields and preserves array order inside compact JSON', () => {
    const document = {
      address: { city: 'LA' },
      values: [3, 1, 2],
      'a.b': true
    }
    const seen = new Set<string>()
    const columns: string[] = []
    collectTabularColumns(document, seen, columns)

    expect(sortTabularColumns(columns, 'alpha')).toEqual(['a.b', 'address', 'values'])
    expect(tabularTextCell(document, 'address')).toBe('{"city":"LA"}')
    expect(tabularTextCell(document, 'values')).toBe('[3,1,2]')
  })

  it('keeps unsafe longs as text and writes canonical dates as spreadsheet dates', () => {
    expect(tabularTextCell({ value: { $numberLong: '9007199254740993' } }, 'value')).toBe('9007199254740993')
    expect(tabularSpreadsheetCell({ value: { $date: { $numberLong: '1786665600000' } } }, 'value')).toEqual(
      new Date(1786665600000)
    )
  })

  it('sanitizes reserved worksheet characters and enforces Excel length', () => {
    expect(sanitizeWorksheetName("'a/b:c*d?e[f]'")).toBe('a b c d e f')
    expect(sanitizeWorksheetName('x'.repeat(40))).toHaveLength(31)
    expect(sanitizeWorksheetName("''")).toBe('Result')
  })
})
