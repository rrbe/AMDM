import type { CollectionSort, TabularDelimiter } from './types'

type Dict = Record<string, unknown>

export type SpreadsheetCell = string | number | boolean | Date | null

export const TABULAR_DELIMITERS = [',', ';', ' ', '\t', '/', '-', '.'] as const satisfies readonly TabularDelimiter[]

export function resolveTabularDelimiter(
  format: 'csv' | 'tsv',
  delimiter?: string
): TabularDelimiter {
  if (delimiter === undefined) return format === 'tsv' ? '\t' : ','
  if (TABULAR_DELIMITERS.includes(delimiter as TabularDelimiter)) return delimiter as TabularDelimiter
  throw new Error(`Unsupported tabular delimiter: ${JSON.stringify(delimiter)}`)
}

function isObject(value: unknown): value is Dict {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function dateToIso(payload: unknown): string {
  if (typeof payload === 'string') return payload
  if (isObject(payload) && '$numberLong' in payload) {
    const ms = Number(payload.$numberLong)
    if (Number.isFinite(ms)) return new Date(ms).toISOString()
  }
  if (typeof payload === 'number') return new Date(payload).toISOString()
  return String(payload)
}

/** Collapse one canonical EJSON wrapper to a stable spreadsheet-friendly value. */
function unwrapExtended(value: Dict): unknown {
  if ('$oid' in value) return String(value.$oid)
  if ('$date' in value) return dateToIso(value.$date)
  if ('$numberInt' in value) return Number(value.$numberInt)
  if ('$numberLong' in value) {
    const text = String(value.$numberLong)
    const number = Number(text)
    return Number.isSafeInteger(number) ? number : text
  }
  if ('$numberDouble' in value) {
    const number = Number(value.$numberDouble)
    return Number.isFinite(number) ? number : String(value.$numberDouble)
  }
  if ('$numberDecimal' in value) return String(value.$numberDecimal)
  if ('$binary' in value) {
    const binary = value.$binary
    return isObject(binary) ? String(binary.base64 ?? '') : String(binary)
  }
  if ('$regularExpression' in value) {
    const regex = value.$regularExpression
    return isObject(regex) ? `/${String(regex.pattern ?? '')}/${String(regex.options ?? '')}` : '/regex/'
  }
  if ('$timestamp' in value) {
    const timestamp = value.$timestamp
    return isObject(timestamp) ? { t: Number(timestamp.t ?? 0), i: Number(timestamp.i ?? 0) } : String(timestamp)
  }
  if ('$minKey' in value) return 'MinKey'
  if ('$maxKey' in value) return 'MaxKey'
  if ('$undefined' in value) return null
  if ('$symbol' in value) return String(value.$symbol)
  if ('$code' in value) {
    return '$scope' in value
      ? { code: String(value.$code), scope: toPlainTabularValue(value.$scope) }
      : String(value.$code)
  }
  if ('$ref' in value && '$id' in value) {
    const ref: Dict = {
      $ref: String(value.$ref),
      $id: toPlainTabularValue(value.$id)
    }
    if (value.$db !== undefined) ref.$db = String(value.$db)
    return ref
  }
  return value
}

function isExtended(value: Dict): boolean {
  const keys = Object.keys(value)
  if (keys.length === 1) {
    return [
      '$oid',
      '$date',
      '$numberInt',
      '$numberLong',
      '$numberDouble',
      '$numberDecimal',
      '$binary',
      '$regularExpression',
      '$timestamp',
      '$minKey',
      '$maxKey',
      '$undefined',
      '$symbol',
      '$code'
    ].includes(keys[0])
  }
  if ('$code' in value) return true
  if ('$ref' in value && '$id' in value) return true
  return '$binary' in value
}

/** Convert EJSON-canonical input to ordinary JSON values without losing large integers. */
export function toPlainTabularValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toPlainTabularValue)
  if (isObject(value)) {
    if (isExtended(value)) return unwrapExtended(value)
    const result: Dict = {}
    for (const [key, nested] of Object.entries(value)) result[key] = toPlainTabularValue(nested)
    return result
  }
  return value
}

/** Top-level field names only; non-document results use a synthetic value column. */
export function collectTabularColumns(document: unknown, seen: Set<string>, columns: string[]): void {
  if (!isObject(document) || isExtended(document)) {
    if (!seen.has('(value)')) {
      seen.add('(value)')
      columns.push('(value)')
    }
    return
  }
  for (const key of Object.keys(document)) {
    if (seen.has(key)) continue
    seen.add(key)
    columns.push(key)
  }
}

export function sortTabularColumns(columns: string[], sort: CollectionSort): string[] {
  return sort === 'alpha' ? [...columns].sort((a, b) => a.localeCompare(b)) : [...columns]
}

function fieldValue(document: unknown, column: string): { present: boolean; value: unknown } {
  if (!isObject(document) || isExtended(document)) {
    return column === '(value)' ? { present: true, value: document } : { present: false, value: undefined }
  }
  if (Object.prototype.hasOwnProperty.call(document, column)) {
    return { present: true, value: document[column] }
  }
  return { present: false, value: undefined }
}

/** Text cell for CSV/TSV. Objects and arrays remain compact JSON in one cell. */
export function tabularTextCell(document: unknown, column: string): string {
  const cell = fieldValue(document, column)
  if (!cell.present) return ''
  const value = toPlainTabularValue(cell.value)
  if (value === null || value === undefined) return ''
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

/** Native cell for XLSX; canonical dates become Date values and nested data remains JSON. */
export function tabularSpreadsheetCell(document: unknown, column: string): SpreadsheetCell {
  const cell = fieldValue(document, column)
  if (!cell.present || cell.value === null || cell.value === undefined) return null
  if (isObject(cell.value) && '$date' in cell.value) {
    const date = new Date(dateToIso(cell.value.$date))
    if (!Number.isNaN(date.valueOf())) return date
  }
  const value = toPlainTabularValue(cell.value)
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  return JSON.stringify(value)
}

export function escapeDelimitedField(text: string, delimiter: string): string {
  if (text.includes(delimiter) || text.includes('"') || text.includes('\n') || text.includes('\r')) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

export function sanitizeWorksheetName(name: string): string {
  const cleaned = name
    .replace(/[\\/*?:[\]]/g, ' ')
    .trim()
    .replace(/^'+|'+$/g, '')
    .trim()
    .replace(/\s+/g, ' ')
  return (cleaned || 'Result').slice(0, 31)
}
