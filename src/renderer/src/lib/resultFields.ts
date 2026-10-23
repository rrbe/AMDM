import { isExtended } from './ejson'
import { isPlainObject } from './tableShape'

export function selectDisplayFields(docs: unknown[], fields: readonly string[] | null): unknown[] {
  if (fields === null) return docs
  const selected = new Set(fields)
  return docs.map((doc) => isPlainObject(doc) && !isExtended(doc)
    ? Object.fromEntries(Object.entries(doc).filter(([key]) => selected.has(key)))
    : doc)
}
