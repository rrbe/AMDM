/**
 * Tabular shape of a result set — the column derivation shared by the Table
 * view and the CSV/TSV serializers (so a copied table matches what's on screen).
 *
 * Columns are the union of top-level field names across all docs (first-seen
 * order), with ONE level of dot-flattening for nested plain objects
 * (`address.city`); EJSON wrappers ({$oid} etc.) stay scalar leaves. Deeper
 * recursion is intentionally out of scope (mirrors ADR-0004 / Phase 2).
 */
import { isExtended } from './ejson'

type Dict = Record<string, unknown>

export function isPlainObject(value: unknown): value is Dict {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The value for `column` in a document, one-level dot-flattened. */
export function cellValue(doc: unknown, column: string): { present: boolean; value: unknown } {
  if (!isPlainObject(doc)) {
    return column === '(value)' ? { present: true, value: doc } : { present: false, value: undefined }
  }
  const dot = column.indexOf('.')
  if (dot === -1) {
    if (!Object.prototype.hasOwnProperty.call(doc, column)) return { present: false, value: undefined }
    return { present: true, value: doc[column] }
  }
  const parent = column.slice(0, dot)
  const child = column.slice(dot + 1)
  const parentVal = doc[parent]
  if (isPlainObject(parentVal) && !isExtended(parentVal)) {
    if (!Object.prototype.hasOwnProperty.call(parentVal, child)) return { present: false, value: undefined }
    return { present: true, value: parentVal[child] }
  }
  return { present: false, value: undefined }
}

/** Derive the ordered column list for a set of documents. */
export function deriveColumns(docs: unknown[]): string[] {
  const seen = new Set<string>()
  const cols: string[] = []
  let sawNonObject = false
  for (const doc of docs) {
    if (!isPlainObject(doc)) {
      sawNonObject = true
      continue
    }
    for (const [key, val] of Object.entries(doc)) {
      if (isPlainObject(val) && !isExtended(val)) {
        // One-level flatten of nested plain objects.
        const childKeys = Object.keys(val)
        if (childKeys.length === 0) {
          if (!seen.has(key)) {
            seen.add(key)
            cols.push(key)
          }
        } else {
          for (const ck of childKeys) {
            const col = `${key}.${ck}`
            if (!seen.has(col)) {
              seen.add(col)
              cols.push(col)
            }
          }
        }
      } else if (!seen.has(key)) {
        seen.add(key)
        cols.push(key)
      }
    }
  }
  if (sawNonObject && cols.length === 0) cols.push('(value)')
  return cols
}
