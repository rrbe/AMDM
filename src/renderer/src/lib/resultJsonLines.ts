import type { CollectionSort } from '@shared/types'
import { isExtended, orderFieldNames } from './ejson'
import { toJsonLines, type JsonLine, type JsonLineSource } from './format'

interface Shape {
  value: Record<string, unknown> | unknown[]
  keys: string[]
  starts: number[]
  children: Map<number, Shape>
  length: number
}

interface Options {
  timeZone?: string
  sort: CollectionSort
  idFirst: boolean
}

const caches = new WeakMap<object, {
  sort: CollectionSort
  idFirst: boolean
  shapes: WeakMap<object, Shape>
  fields?: readonly string[] | null
  timeZone?: string
  source?: JsonLineSource<JsonLine>
}>()

export function cachedResultJsonLines(docs: unknown, fields: readonly string[] | null, options: Options): JsonLineSource<JsonLine> | undefined {
  const cache = typeof docs === 'object' && docs !== null ? caches.get(docs) : undefined
  return cache?.sort === options.sort && cache.idFirst === options.idFirst && cache.fields === fields && cache.timeZone === options.timeZone
    ? cache.source : undefined
}

export async function createResultJsonLines(
  docs: unknown, fields: readonly string[] | null, options: Options, signal: AbortSignal
): Promise<JsonLineSource<JsonLine>> {
  const existing = cachedResultJsonLines(docs, fields, options)
  if (existing) return existing
  const cacheKey = typeof docs === 'object' && docs !== null ? docs : undefined
  let cache = cacheKey ? caches.get(cacheKey) : undefined
  if (!cache || cache.sort !== options.sort || cache.idFirst !== options.idFirst) {
    cache = { sort: options.sort, idFirst: options.idFirst, shapes: new WeakMap() }
    if (cacheKey) caches.set(cacheKey, cache)
  }
  const shapes = cache.shapes
  const selected = fields === null ? null : new Set(fields)
  function* prepare(value: unknown, depth: number): Generator<void, Shape | undefined> {
    if (typeof value !== 'object' || value === null || isExtended(value)) return undefined
    const filtered = depth === 1 && !Array.isArray(value) && selected !== null
    const selectionRoot = depth === 0 && selected !== null
    const cached = shapes.get(value)
    if (cached && !filtered && !selectionRoot) return cached
    const array = Array.isArray(value)
    const keys = filtered && selected.size === 0 ? [] : cached?.keys ?? (array ? Array.from({ length: value.length }, (_, index) => String(index)) : orderFieldNames(Object.keys(value), options.sort, options.idFirst))
    const shape: Shape = { value: value as Shape['value'], keys: filtered ? [] : keys, starts: [], children: new Map(), length: !filtered && keys.length ? 2 : 1 }
    for (let index = 0; index < keys.length; index++) {
      if (index % 256 === 0) yield
      if (filtered && !selected.has(keys[index])) continue
      const projectedIndex = filtered ? shape.keys.length : index
      if (filtered) {
        if (shape.keys.length === 0) shape.length = 2
        shape.keys.push(keys[index])
      }
      const child = cached && filtered ? cached.children.get(index) : yield* prepare((value as Record<string, unknown>)[keys[index]], depth + 1)
      shape.starts.push(shape.length - 1)
      if (child) shape.children.set(projectedIndex, child)
      shape.length += child?.length ?? 1
    }
    if (!filtered && !selectionRoot) shapes.set(value, shape)
    return shape
  }
  const iterator = prepare(docs, 0)
  let deadline = performance.now() + 6
  let step = iterator.next()
  while (!step.done) {
    if (signal.aborted) {
      iterator.return(undefined)
      throw new DOMException('Aborted', 'AbortError')
    }
    if (performance.now() >= deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      deadline = performance.now() + 6
    }
    step = iterator.next()
  }
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  const root = step.value
  const length = root?.length ?? 1
  const formatted = new Map<number, JsonLine>()
  const getLine = (index: number): JsonLine => {
    const hit = formatted.get(index)
    if (hit) return hit
    if (!root) return toJsonLines(docs, options.timeZone, options.sort, options.idFirst)[0]
    let shape = root
    let start = 0
    let depth = 0
    let key: string | null = null
    let comma = false
    let line: JsonLine
    while (true) {
      const array = Array.isArray(shape.value)
      const prefix = key === null ? '' : `${key}: `
      const keyTokens = key === null ? [] : [{ text: key, cls: 'json-key' }, { text: ': ', cls: 'json-punct' }]
      const suffix = comma ? ',' : ''
      if (shape.keys.length === 0) {
        const text = array ? '[]' : '{}'
        line = { depth, text: prefix + text + suffix, tokens: [...keyTokens, { text, cls: 'json-punct' }, ...(comma ? [{ text: ',', cls: 'json-punct' }] : [])] }
        break
      }
      if (index === start) {
        const closeText = (array ? ']' : '}') + suffix
        line = { depth, text: prefix + (array ? '[' : '{'), tokens: [...keyTokens, { text: array ? '[' : '{', cls: 'json-punct' }], fold: { end: start + shape.length - 1, closeText } }
        break
      }
      if (index === start + shape.length - 1) {
        const text = array ? ']' : '}'
        line = { depth, text: text + suffix, tokens: [{ text, cls: 'json-punct' }, ...(comma ? [{ text: ',', cls: 'json-punct' }] : [])] }
        break
      }
      let low = 0
      let high = shape.starts.length
      while (low + 1 < high) {
        const middle = (low + high) >>> 1
        if (shape.starts[middle] <= index - start) low = middle
        else high = middle
      }
      const childKey = shape.keys[low]
      key = array ? null : JSON.stringify(childKey)
      comma = low < shape.keys.length - 1
      depth++
      const child = shape.children.get(low)
      if (child) {
        start += shape.starts[low]
        shape = child
        continue
      }
      const scalar = toJsonLines((shape.value as Record<string, unknown>)[childKey], options.timeZone, options.sort, options.idFirst)[0]
      const scalarPrefix = key === null ? '' : `${key}: `
      line = {
        depth,
        text: scalarPrefix + scalar.text + (comma ? ',' : ''),
        tokens: [
          ...(key === null ? [] : [{ text: key, cls: 'json-key' }, { text: ': ', cls: 'json-punct' }]),
          ...scalar.tokens,
          ...(comma ? [{ text: ',', cls: 'json-punct' }] : [])
        ]
      }
      break
    }
    if (formatted.size >= 256) formatted.delete(formatted.keys().next().value!)
    formatted.set(index, line)
    return line
  }
  const source: JsonLineSource<JsonLine> = {
    length,
    getLine,
    hasFoldable: (includeRoot) => !!root && root.keys.length > 0 && (includeRoot || [...root.children.values()].some((child) => child.keys.length > 0)),
    foldableIndexes(includeRoot) {
      const indexes: number[] = []
      const visit = (shape: Shape, start: number, depth: number): void => {
        if (!shape.keys.length) return
        if (includeRoot || depth > 0) indexes.push(start)
        for (const [index, child] of shape.children) visit(child, start + shape.starts[index], depth + 1)
      }
      if (root) visit(root, 0, 0)
      return indexes
    },
    visibleRows(collapsed) {
      const ranges: { start: number; row: number; length: number }[] = []
      let cursor = 0
      let count = 0
      for (const index of [...collapsed].sort((a, b) => a - b)) {
        if (index < cursor || index >= length) continue
        const fold = getLine(index).fold
        if (!fold) continue
        const rangeLength = index + 1 - cursor
        ranges.push({ start: cursor, row: count, length: rangeLength })
        count += rangeLength
        cursor = fold.end + 1
      }
      if (cursor < length) ranges.push({ start: cursor, row: count, length: length - cursor })
      count += length - cursor
      return {
        length: count,
        at(row) {
          let low = 0
          let high = ranges.length
          while (low + 1 < high) {
            const middle = (low + high) >>> 1
            if (ranges[middle].row <= row) low = middle
            else high = middle
          }
          return ranges[low].start + row - ranges[low].row
        }
      }
    }
  }
  cache.fields = fields
  cache.timeZone = options.timeZone
  cache.source = source
  return source
}
