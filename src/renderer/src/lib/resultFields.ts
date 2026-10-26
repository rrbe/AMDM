import { isExtended } from './ejson'
import { isPlainObject } from './tableShape'

const fieldInfoCache = new WeakMap<unknown[], {
  fields: string[]
  allDocuments: boolean
  documents: { value: unknown; keys: string[] | null }[]
}>()

function* collectResultFieldInfo(docs: unknown[]) {
  const fields = new Set<string>()
  const documents: { value: unknown; keys: string[] | null }[] = []
  for (const value of docs) {
    const keys = isPlainObject(value) && !isExtended(value) ? Object.keys(value) : null
    if (keys) for (const key of keys) fields.add(key)
    documents.push({ value, keys })
    yield
  }
  return {
    fields: [...fields],
    allDocuments: docs.length > 0 && documents.every(({ keys }) => keys !== null),
    documents
  }
}

export function cachedResultFieldInfo(docs: unknown[]) {
  return fieldInfoCache.get(docs)
}

export function getResultFieldInfo(docs: unknown[]) {
  const cached = fieldInfoCache.get(docs)
  if (cached) return cached
  const iterator = collectResultFieldInfo(docs)
  let step = iterator.next()
  while (!step.done) step = iterator.next()
  const info = step.value
  fieldInfoCache.set(docs, info)
  return info
}

export async function prepareResultFieldInfo(docs: unknown[], signal: AbortSignal) {
  const cached = fieldInfoCache.get(docs)
  if (cached) return cached
  const iterator = collectResultFieldInfo(docs)
  let step = iterator.next()
  let deadline = performance.now() + 6
  while (!step.done) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    if (performance.now() >= deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      deadline = performance.now() + 6
    }
    step = iterator.next()
  }
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  fieldInfoCache.set(docs, step.value)
  return step.value
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
