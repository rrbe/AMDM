/**
 * Tabular shape of a result set — the column derivation shared by the Table
 * view and the CSV/TSV serializers (so a copied table matches what's on screen).
 *
 * Columns are the union of top-level field names across all docs. Nested
 * objects and arrays remain single cells and open in the value-preview modal.
 */
import type { CollectionSort } from '@shared/types'

type Dict = Record<string, unknown>

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
