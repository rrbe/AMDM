/**
 * Tabular shape of a result set — the column derivation shared by the Table
 * view and the CSV/TSV serializers (so a copied table matches what's on screen).
 *
 * Columns are the union of top-level field names across all docs. Nested
 * objects and arrays remain single cells and open in the value-preview modal.
 */
import type { CollectionSort } from '@shared/types'
import { formatScalar, isExtended } from '@renderer/lib/ejson'

type Dict = Record<string, unknown>

export type TableSortDirection = 'asc' | 'desc'

export interface TableSortState {
  column: string
  direction: TableSortDirection
}

export interface TableRow {
  doc: unknown
  /** Index in the query result before Table-only sorting is applied. */
  sourceIndex: number
}

export function isPlainObject(value: unknown): value is Dict {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The top-level value for `column` in a document. */
export function cellValue(doc: unknown, column: string): { present: boolean; value: unknown } {
  if (!isPlainObject(doc)) {
    return column === '(value)' ? { present: true, value: doc } : { present: false, value: undefined }
  }
  if (Object.prototype.hasOwnProperty.call(doc, column)) return { present: true, value: doc[column] }
  return { present: false, value: undefined }
}

/** Derive the ordered column list for a set of documents. */
export function deriveColumns(docs: unknown[], sort: CollectionSort = 'alpha'): string[] {
  const seen = new Set<string>()
  const cols: string[] = []
  let sawNonObject = false
  for (const doc of docs) {
    if (!isPlainObject(doc)) {
      sawNonObject = true
      continue
    }
    for (const key of Object.keys(doc)) {
      if (!seen.has(key)) {
        seen.add(key)
        cols.push(key)
      }
    }
  }
  if (sawNonObject && cols.length === 0) cols.push('(value)')
  return sort === 'alpha' ? cols.sort((a, b) => a.localeCompare(b)) : cols
}

/**
 * Build the Table's visible row order without mutating the query result.
 *
 * Values are compared by their useful UI type (numbers numerically, dates by
 * time, strings naturally, and so on). Null, undefined, and missing fields stay
 * at the end in both directions. Equal values retain server order.
 */
export function sortTableRows(docs: unknown[], sort: TableSortState | null, locale?: string): TableRow[] {
  const rows = docs.map((doc, sourceIndex) => ({ doc, sourceIndex }))
  if (!sort) return rows

  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' })
  // Build every sort key once. In particular, container keys are shallow and
  // bounded; Array.sort never walks/stringifies a nested value per comparison.
  const prepared = rows.map((row) => ({ ...row, key: prepareSortKey(cellValue(row.doc, sort.column)) }))
  prepared.sort((left, right) => {
    const leftEmpty = left.key.kind === 'empty'
    const rightEmpty = right.key.kind === 'empty'
    if (leftEmpty !== rightEmpty) return leftEmpty ? 1 : -1
    if (leftEmpty && rightEmpty) return left.sourceIndex - right.sourceIndex

    const compared = compareSortKeys(left.key, right.key, collator)
    if (compared === 0) return left.sourceIndex - right.sourceIndex
    return sort.direction === 'asc' ? compared : -compared
  })
  return prepared.map(({ doc, sourceIndex }) => ({ doc, sourceIndex }))
}

type SortKind =
  | 'empty'
  | 'number'
  | 'date'
  | 'timestamp'
  | 'string'
  | 'objectId'
  | 'boolean'
  | 'array'
  | 'object'
  | 'other'

const SORT_KIND_RANK: Record<SortKind, number> = {
  empty: 0,
  number: 1,
  date: 2,
  timestamp: 3,
  string: 4,
  objectId: 5,
  boolean: 6,
  array: 7,
  object: 8,
  other: 9
}

type SortKey =
  | { kind: 'empty' }
  | { kind: 'number' | 'date'; value: NumericSortKey }
  | { kind: 'timestamp'; time: NumericSortKey; increment: NumericSortKey }
  | { kind: 'string' | 'objectId' | 'other'; value: string }
  | { kind: 'boolean' | 'array' | 'object'; value: number }

interface NumericSortKey {
  text: string
  parsed: ParsedNumber | null
}

function prepareSortKey(cell: { present: boolean; value: unknown }): SortKey {
  if (
    !cell.present ||
    cell.value === null ||
    cell.value === undefined ||
    (isSingleMarker(cell.value, '$undefined') && cell.value['$undefined'] === true)
  ) {
    return { kind: 'empty' }
  }

  const value = cell.value
  const number = numericText(value)
  if (number !== null) return { kind: 'number', value: numericSortKey(number) }
  const date = dateNumericText(value)
  if (date !== null) return { kind: 'date', value: numericSortKey(date) }
  const timestamp = timestampNumericKeys(value)
  if (timestamp) return { kind: 'timestamp', ...timestamp }
  if (typeof value === 'string' || isSingleMarker(value, '$symbol')) {
    return { kind: 'string', value: stringText(value) }
  }
  if (isSingleMarker(value, '$oid')) {
    return { kind: 'objectId', value: String(value['$oid']).toLowerCase() }
  }
  if (typeof value === 'boolean') return { kind: 'boolean', value: Number(value) }
  if (Array.isArray(value)) return { kind: 'array', value: value.length }
  if (isPlainObject(value) && !isExtended(value)) return { kind: 'object', value: Object.keys(value).length }
  return { kind: 'other', value: formatScalar(value).text }
}

function compareSortKeys(left: SortKey, right: SortKey, collator: Intl.Collator): number {
  if (left.kind !== right.kind) return SORT_KIND_RANK[left.kind] - SORT_KIND_RANK[right.kind]

  switch (left.kind) {
    case 'number':
    case 'date':
      return compareNumericSortKeys(left.value, (right as typeof left).value, collator)
    case 'timestamp': {
      const other = right as typeof left
      const time = compareNumericSortKeys(left.time, other.time, collator)
      return time === 0 ? compareNumericSortKeys(left.increment, other.increment, collator) : time
    }
    case 'objectId':
      return compareLexical(left.value, (right as typeof left).value)
    case 'boolean':
    case 'array':
    case 'object':
      return left.value - (right as typeof left).value
    case 'string':
    case 'other':
      return collator.compare(left.value, (right as typeof left).value)
    case 'empty':
      return 0
  }
}

function numericSortKey(text: string): NumericSortKey {
  return { text, parsed: parseNumericText(text) }
}

function compareLexical(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

function numericText(value: unknown): string | null {
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  if (!isPlainObject(value) || Object.keys(value).length !== 1) return null
  for (const marker of ['$numberInt', '$numberLong', '$numberDouble', '$numberDecimal']) {
    if (marker in value) return String(value[marker])
  }
  return null
}

function dateNumericText(value: unknown): string | null {
  if (!isSingleMarker(value, '$date')) return null
  const payload = value['$date']
  if (typeof payload === 'number' || typeof payload === 'bigint') return String(payload)
  if (typeof payload === 'string') {
    const timestamp = Date.parse(payload)
    return Number.isNaN(timestamp) ? null : String(timestamp)
  }
  return numericText(payload)
}

function timestampNumericKeys(
  value: unknown
): { time: NumericSortKey; increment: NumericSortKey } | null {
  if (!isSingleMarker(value, '$timestamp')) return null
  const payload = value['$timestamp']
  if (!isPlainObject(payload)) return null
  const time = numericText(payload['t'])
  const increment = numericText(payload['i'])
  return time === null || increment === null
    ? null
    : { time: numericSortKey(time), increment: numericSortKey(increment) }
}

function stringText(value: unknown): string {
  return typeof value === 'string' ? value : String((value as Dict)['$symbol'])
}

function isSingleMarker(value: unknown, marker: string): value is Dict {
  return isPlainObject(value) && Object.keys(value).length === 1 && marker in value
}

type ParsedNumber =
  | { special: 'negativeInfinity' | 'positiveInfinity' | 'nan' }
  | { special: 'finite'; sign: -1 | 0 | 1; digits: string; exponent: number }

function compareNumericSortKeys(left: NumericSortKey, right: NumericSortKey, collator: Intl.Collator): number {
  const a = left.parsed
  const b = right.parsed
  if (!a || !b) return collator.compare(left.text, right.text)

  const specialRank = (value: ParsedNumber): number => {
    if (value.special === 'negativeInfinity') return 0
    if (value.special === 'finite') return 1
    if (value.special === 'positiveInfinity') return 2
    return 3
  }
  const rank = specialRank(a) - specialRank(b)
  if (rank !== 0) return rank
  if (a.special !== 'finite' || b.special !== 'finite') return 0
  if (a.sign !== b.sign) return a.sign - b.sign
  if (a.sign === 0 || b.sign === 0) return 0

  const magnitudeA = a.digits.length + a.exponent
  const magnitudeB = b.digits.length + b.exponent
  let compared = magnitudeA - magnitudeB
  if (compared === 0) {
    const length = Math.max(a.digits.length, b.digits.length)
    compared = a.digits.padEnd(length, '0').localeCompare(b.digits.padEnd(length, '0'))
  }
  return a.sign === 1 ? compared : -compared
}

function parseNumericText(input: string): ParsedNumber | null {
  const token = input.trim().toLowerCase()
  if (token === '-infinity' || token === '-inf') return { special: 'negativeInfinity' }
  if (token === 'infinity' || token === '+infinity' || token === 'inf' || token === '+inf') {
    return { special: 'positiveInfinity' }
  }
  if (token === 'nan' || token === '+nan' || token === '-nan') return { special: 'nan' }

  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:e([+-]?\d+))?$/.exec(token)
  if (!match) return null
  const integer = match[2] ?? ''
  const fraction = match[3] ?? match[4] ?? ''
  let digits = `${integer}${fraction}`.replace(/^0+/, '')
  if (!digits) return { special: 'finite', sign: 0, digits: '0', exponent: 0 }

  let exponent = Number(match[5] ?? 0) - fraction.length
  while (digits.endsWith('0')) {
    digits = digits.slice(0, -1)
    exponent += 1
  }
  return {
    special: 'finite',
    sign: match[1] === '-' ? -1 : 1,
    digits,
    exponent
  }
}
