import { parse as parseJs } from '@babel/parser'
import type { Collection, Db, DistinctOptions, Document, FindOptions } from 'mongodb'
import type { ShellOutputLine } from '../../shared/types'
import { serializerPool } from '../workers/serializerPool'

/** Bound Console output until transport supports streaming. */
export const MAX_OUTPUT_LINES = 1000

/** Serialization may finish in a worker after Stop; discard its late result. */
export function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) {
    void promise.catch(() => {})
    return Promise.reject(signal.reason)
  }
  return new Promise((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      }
    )
  })
}

export function wrapTopLevelAwait(code: string): string {
  const ast = parseJs(code, { sourceType: 'script', allowAwaitOutsideFunction: true })
  const body = ast.program.body
  const last = body[body.length - 1]
  let inner = code
  if (last?.type === 'ExpressionStatement') {
    const expr = last.expression as { start: number; end: number }
    inner =
      code.slice(0, last.start as number) +
      'return (' +
      code.slice(expr.start, expr.end) +
      ');' +
      code.slice(last.end as number)
  }
  return `(async () => { ${inner}\n})()`
}

/** Preserve AMDM's explicit top-level-await extension before code enters an
    evaluator that otherwise parses it as a script. This is a parse-only
    decision: execution is never retried in another shape. */
export function prepareTopLevelAwait(code: string): string {
  try {
    parseJs(code, { sourceType: 'script' })
    return code
  } catch (error) {
    if (error instanceof SyntaxError && /'await' is only allowed/.test(error.message)) {
      return wrapTopLevelAwait(code)
    }
    return code
  }
}

function withReadOptions(
  options: Document | undefined,
  signal?: AbortSignal,
  timeoutMS?: number
): Document | undefined {
  if (!signal && !timeoutMS) return options
  return {
    ...(timeoutMS ? { maxTimeMS: timeoutMS } : {}),
    ...(options ?? {}),
    ...(signal ? { signal } : {})
  }
}

function makeDriverCollProxy(coll: Collection, signal?: AbortSignal, timeoutMS?: number): Collection {
  return new Proxy(coll, {
    get(target, prop, receiver) {
      if (typeof prop !== 'string') return Reflect.get(target, prop, receiver)
      switch (prop) {
        case 'find':
          return (filter?: Document, options?: Document) =>
            target.find(filter ?? {}, withReadOptions(options, signal, timeoutMS) as FindOptions)
        case 'findOne':
          return (filter?: Document, options?: Document) =>
            target.findOne(filter ?? {}, withReadOptions(options, signal, timeoutMS) as FindOptions)
        case 'aggregate':
          return (pipeline?: Document[], options?: Document) =>
            target.aggregate(pipeline ?? [], withReadOptions(options, signal, timeoutMS))
        case 'countDocuments':
          return (filter?: Document, options?: Document) =>
            target.countDocuments(filter ?? {}, withReadOptions(options, signal, timeoutMS))
        case 'distinct':
          return (key: string, filter?: Document, options?: Document) =>
            target.distinct(key, filter ?? {}, withReadOptions(options, signal, timeoutMS) as DistinctOptions)
        case 'indexes':
          return (options?: Document) => target.indexes(withReadOptions(options, signal, timeoutMS))
      }
      const value = (target as unknown as Record<string, unknown>)[prop]
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value
    }
  })
}

export function makeDriverDbProxy(db: Db, signal?: AbortSignal, timeoutMS?: number): Db {
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (typeof prop !== 'string') return Reflect.get(target, prop, receiver)
      switch (prop) {
        case 'collection':
          return (name: string) => makeDriverCollProxy(target.collection(name), signal, timeoutMS)
        case 'aggregate':
          return (pipeline?: Document[], options?: Document) =>
            target.aggregate(pipeline ?? [], withReadOptions(options, signal, timeoutMS))
        case 'command':
          return (command: Document, options?: Document) =>
            target.command(command, withReadOptions(options, signal, timeoutMS))
        case 'listCollections':
          return (filter?: Document, options?: Document) =>
            target.listCollections(filter ?? {}, withReadOptions(options, signal, timeoutMS))
      }
      const value = (target as unknown as Record<string, unknown>)[prop]
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value
    }
  })
}

export class OutputCollector {
  private entries: { kind: 'print' | 'printjson'; values: unknown[]; level: 'log' | 'warn' | 'error' }[] = []
  truncated = false

  push(kind: 'print' | 'printjson', values: unknown[], level: 'log' | 'warn' | 'error' = 'log'): void {
    if (this.entries.length >= MAX_OUTPUT_LINES) {
      this.truncated = true
      return
    }
    this.entries.push({ kind, values, level })
  }

  get size(): number {
    return this.entries.length
  }

  /** Convert the collected raw values into EJSON-safe wire lines. */
  async toLines(): Promise<ShellOutputLine[]> {
    const lines: ShellOutputLine[] = []
    for (const e of this.entries) {
      if (e.kind === 'printjson') {
        lines.push({ kind: 'json', data: await serializerPool.serializeOne(e.values[0] ?? null), level: e.level })
        continue
      }
      // print/console: primitives via String(); objects (likely BSON) as a
      // compact EJSON string so `print('found:', doc)` stays one line.
      const parts: string[] = []
      for (const v of e.values) {
        if (v !== null && typeof v === 'object') {
          try {
            parts.push(JSON.stringify(await serializerPool.serializeOne(v)))
          } catch {
            parts.push(String(v))
          }
        } else {
          parts.push(String(v))
        }
      }
      lines.push({ kind: 'text', text: parts.join(' '), level: e.level })
    }
    return lines
  }
}

const DB_METHODS = new Set([
  'getMongo',
  'getCollection',
  'getSiblingDB',
  'getCollectionNames',
  'getCollectionInfos',
  'getName',
  'version',
  'runCommand',
  'adminCommand',
  'aggregate',
  'command',
  'stats',
  'listCollections',
  'admin',
  'collection',
  'dropDatabase',
  'createCollection',
  'watch'
])

/** Best-effort: which collection does this code target (for doc edit/delete)? */
export function detectCollection(code: string): string | undefined {
  const getColl = /\bdb\.getCollection\(\s*['"]([^'"]+)['"]\s*\)/.exec(code)
  if (getColl) return getColl[1]
  const bracket = /\bdb\[\s*['"]([^'"]+)['"]\s*\]/.exec(code)
  if (bracket) return bracket[1]
  const dot = /\bdb\.([A-Za-z_$][\w$]*)/.exec(code)
  if (dot && !DB_METHODS.has(dot[1])) return dot[1]
  return undefined
}
