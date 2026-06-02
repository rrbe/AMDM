import vm from 'node:vm'
import { EJSON, ObjectId, Long, Decimal128, Binary, Timestamp, MinKey, MaxKey, UUID } from 'bson'
import type { Db } from 'mongodb'
import type { ShellRequest, ShellResult } from '../../shared/types'
import { sessionManager } from './sessionManager'

const DEFAULT_LIMIT = 50
const EXEC_TIMEOUT_MS = 30_000

/**
 * Build the sandbox `db` object. `db.<name>` resolves to a real Collection
 * (so `db.lives.find()` works), while genuine Db methods (aggregate, command,
 * listCollections, …) pass through. This is the focused shell-on-driver model
 * from ADR-0003 — typed BSON in, typed BSON out.
 */
function makeDbProxy(db: Db): Db {
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (typeof prop !== 'string') return Reflect.get(target, prop, receiver)
      if (prop === 'getCollection') return (name: string) => target.collection(name)
      if (prop === 'getSiblingDB') return (name: string) => makeDbProxy(target.client.db(name))
      if (prop in target) {
        const val = (target as unknown as Record<string, unknown>)[prop]
        return typeof val === 'function' ? (val as (...a: unknown[]) => unknown).bind(target) : val
      }
      // Unknown property → treat as a collection name.
      return target.collection(prop)
    }
  })
}

function makeSandbox(db: Db): Record<string, unknown> {
  return {
    db: makeDbProxy(db),
    ObjectId,
    ISODate: (s?: string) => (s ? new Date(s) : new Date()),
    Date,
    NumberLong: (v: string | number) => Long.fromString(String(v)),
    NumberInt: (v: string | number) => parseInt(String(v), 10),
    NumberDecimal: (v: string | number) => Decimal128.fromString(String(v)),
    UUID: (s?: string) => (s ? new UUID(s) : new UUID()),
    BinData: (subtype: number, base64: string) =>
      new Binary(Buffer.from(base64, 'base64'), subtype),
    Timestamp,
    MinKey,
    MaxKey,
    // Shell print helpers are no-ops here; the result is the completion value.
    print: () => undefined,
    printjson: () => undefined,
    console: { log: () => undefined, error: () => undefined, warn: () => undefined }
  }
}

interface CursorLike {
  [Symbol.asyncIterator](): AsyncIterator<unknown>
  close?: () => Promise<void>
}

function isCursor(v: unknown): v is CursorLike {
  return (
    !!v &&
    typeof v === 'object' &&
    typeof (v as { toArray?: unknown }).toArray === 'function' &&
    typeof (v as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function'
  )
}

async function drainCursor(
  cursor: CursorLike,
  limit: number
): Promise<{ docs: unknown[]; truncated: boolean }> {
  const docs: unknown[] = []
  for await (const doc of cursor) {
    docs.push(doc)
    if (docs.length > limit) break // fetch one extra to detect truncation
  }
  const truncated = docs.length > limit
  if (truncated) docs.pop()
  await cursor.close?.().catch(() => {})
  return { docs, truncated }
}

/** EJSON-canonical → plain JSON-cloneable (safe to send over IPC). */
function serialize(value: unknown): unknown {
  return JSON.parse(EJSON.stringify(value, { relaxed: false }))
}

interface Explainable {
  explain(verbosity: string): Promise<unknown>
}

function isExplainable(v: unknown): v is Explainable {
  return !!v && typeof v === 'object' && typeof (v as { explain?: unknown }).explain === 'function'
}

const DB_METHODS = new Set([
  'getCollection',
  'getSiblingDB',
  'aggregate',
  'runCommand',
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
function detectCollection(code: string): string | undefined {
  const getColl = /\bdb\.getCollection\(\s*['"]([^'"]+)['"]\s*\)/.exec(code)
  if (getColl) return getColl[1]
  const bracket = /\bdb\[\s*['"]([^'"]+)['"]\s*\]/.exec(code)
  if (bracket) return bracket[1]
  const dot = /\bdb\.([A-Za-z_$][\w$]*)/.exec(code)
  if (dot && !DB_METHODS.has(dot[1])) return dot[1]
  return undefined
}

export async function executeShell(req: ShellRequest): Promise<ShellResult> {
  const client = sessionManager.getClient(req.connectionId)
  const db = client.db(req.database)
  const limit = req.limit ?? DEFAULT_LIMIT
  const started = Date.now()
  const collection = detectCollection(req.code)

  try {
    const sandbox = makeSandbox(db)
    const context = vm.createContext(sandbox)
    // The completion value of the script is the value of its last expression
    // (REPL semantics), so `db.coll.find({})` yields the cursor.
    const script = new vm.Script(req.code, { filename: 'shell.js' })
    let result: unknown = script.runInContext(context, { timeout: EXEC_TIMEOUT_MS })

    // Unwrap a returned promise (findOne, updateOne, countDocuments, …).
    if (result && typeof (result as { then?: unknown }).then === 'function') {
      result = await result
    }

    // Explain path: don't fetch — run explain('executionStats') on the cursor.
    if (req.explain) {
      if (isExplainable(result)) {
        const plan = await result.explain('executionStats')
        return { kind: 'explain', data: serialize(plan), collection, elapsedMs: Date.now() - started }
      }
      return {
        kind: 'error',
        error: 'Explain is only supported for find()/aggregate() queries.',
        errorName: 'ExplainError',
        collection,
        elapsedMs: Date.now() - started
      }
    }

    const elapsedMs = Date.now() - started

    if (isCursor(result)) {
      const { docs, truncated } = await drainCursor(result, limit)
      return {
        kind: 'documents',
        data: docs.map((d) => serialize(d)),
        count: docs.length,
        truncated,
        collection,
        elapsedMs: Date.now() - started
      }
    }

    if (Array.isArray(result)) {
      return {
        kind: 'documents',
        data: result.map((d) => serialize(d)),
        count: result.length,
        truncated: false,
        collection,
        elapsedMs
      }
    }

    if (result && typeof result === 'object' && 'acknowledged' in result) {
      return { kind: 'ack', data: serialize(result), collection, elapsedMs }
    }

    return { kind: 'value', data: serialize(result ?? null), collection, elapsedMs }
  } catch (err) {
    return {
      kind: 'error',
      error: err instanceof Error ? err.message : String(err),
      errorName: err instanceof Error ? err.name : 'Error',
      collection,
      elapsedMs: Date.now() - started
    }
  }
}
