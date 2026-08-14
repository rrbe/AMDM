/**
 * Tabular shape of a result set — the column derivation shared by the Table
 * view and the CSV/TSV serializers (so a copied table matches what's on screen).
 *
 * Columns are the union of top-level field names across all docs. Nested
 * objects and arrays remain single cells and open in the value-preview modal.
 */
import type { CollectionSort } from '@shared/types'
import { isExtended } from '@renderer/lib/ejson'

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
  rows.sort((left, right) => {
    const leftCell = cellValue(left.doc, sort.column)
    const rightCell = cellValue(right.doc, sort.column)
    const leftEmpty = isEmptySortValue(leftCell)
    const rightEmpty = isEmptySortValue(rightCell)

    // Empty cells remain last even for descending order.
    if (leftEmpty !== rightEmpty) return leftEmpty ? 1 : -1
    if (leftEmpty && rightEmpty) return left.sourceIndex - right.sourceIndex

    const compared = comparePresentValues(leftCell.value, rightCell.value, collator)
    if (compared === 0) return left.sourceIndex - right.sourceIndex
    return sort.direction === 'asc' ? compared : -compared
  })
  return rows
}

function isEmptySortValue(cell: { present: boolean; value: unknown }): boolean {
  if (!cell.present || cell.value === null || cell.value === undefined) return true
  return isPlainObject(cell.value) && Object.keys(cell.value).length === 1 && '$undefined' in cell.value
}

type SortKind = 'number' | 'date' | 'string' | 'objectId' | 'boolean' | 'array' | 'object' | 'other'

const SORT_KIND_RANK: Record<SortKind, number> = {
  number: 0,
  date: 1,
  string: 2,
  objectId: 3,
  boolean: 4,
  array: 5,
  object: 6,
  other: 7
}

function comparePresentValues(left: unknown, right: unknown, collator: Intl.Collator): number {
  const leftKind = sortKind(left)
  const rightKind = sortKind(right)
  if (leftKind !== rightKind) return SORT_KIND_RANK[leftKind] - SORT_KIND_RANK[rightKind]

  switch (leftKind) {
    case 'number':
      return compareNumericText(numericText(left)!, numericText(right)!, collator)
    case 'date':
      return compareNumericText(dateNumericText(left)!, dateNumericText(right)!, collator)
    case 'string':
      return collator.compare(stringText(left), stringText(right))
    case 'objectId':
      return collator.compare(String((left as Dict)['$oid']), String((right as Dict)['$oid']))
    case 'boolean':
      return Number(left) - Number(right)
    default:
      return collator.compare(stableValueText(left), stableValueText(right))
  }
}

function sortKind(value: unknown): SortKind {
  if (numericText(value) !== null) return 'number'
  if (dateNumericText(value) !== null) return 'date'
  if (typeof value === 'string' || isSingleMarker(value, '$symbol')) return 'string'
  if (isSingleMarker(value, '$oid')) return 'objectId'
  if (typeof value === 'boolean') return 'boolean'
  if (Array.isArray(value)) return 'array'
  if (isPlainObject(value) && !isExtended(value)) return 'object'
  return 'other'
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

function stringText(value: unknown): string {
  return typeof value === 'string' ? value : String((value as Dict)['$symbol'])
}

function isSingleMarker(value: unknown, marker: string): value is Dict {
  return isPlainObject(value) && Object.keys(value).length === 1 && marker in value
}

type ParsedNumber =
  | { special: 'negativeInfinity' | 'positiveInfinity' | 'nan' }
  | { special: 'finite'; sign: -1 | 0 | 1; digits: string; exponent: number }

function compareNumericText(left: string, right: string, collator: Intl.Collator): number {
  const a = parseNumericText(left)
  const b = parseNumericText(right)
  if (!a || !b) return collator.compare(left, right)

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

function stableValueText(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (typeof value === 'bigint') return `${value}n`
  if (Array.isArray(value)) return `[${value.map(stableValueText).join(',')}]`
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableValueText(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? String(value)
}
