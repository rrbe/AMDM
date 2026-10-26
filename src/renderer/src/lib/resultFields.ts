import { isExtended } from './ejson'
import { isPlainObject } from './tableShape'

const fieldInfoCache = new WeakMap<unknown[], {
  fields: string[]
  allDocuments: boolean
  documents: { value: unknown; keys: string[] | null }[]
}>()

export function getResultFieldInfo(docs: unknown[]) {
  const cached = fieldInfoCache.get(docs)
  if (cached) return cached
  const fields = new Set<string>()
  const documents = docs.map((value) => {
    const keys = isPlainObject(value) && !isExtended(value) ? Object.keys(value) : null
    if (keys) for (const key of keys) fields.add(key)
    return { value, keys }
  })
  const info = {
    fields: [...fields],
    allDocuments: docs.length > 0 && documents.every(({ keys }) => keys !== null),
    documents
  }
  fieldInfoCache.set(docs, info)
  return info
}

export function selectDisplayFields(docs: unknown[], fields: readonly string[] | null): unknown[] {
  if (fields === null) return docs
  const selected = new Set(fields)
  return getResultFieldInfo(docs).documents.map(({ value, keys }) => {
    if (keys === null) return value
    const doc = value as Record<string, unknown>
    const shown = keys.filter((key) => selected.has(key))
    if (shown.length === keys.length) return doc
    if (shown.length > keys.length / 2) {
      const projected = { ...doc }
      for (const key of keys) if (!selected.has(key)) delete projected[key]
      return projected
    }
    return Object.fromEntries(shown.map((key) => [key, doc[key]]))
  })
}
