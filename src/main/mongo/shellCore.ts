/**
 * Shell-on-driver core (ADR-0003) — the part that turns a user's JavaScript
 * snippet into a typed-BSON {@link ShellResult}, with NO Electron/session
 * dependencies so it can be exercised in isolation against a real `Db`.
 *
 * `executeShell` (shellEngine.ts) is a thin wrapper that resolves the live
 * MongoClient and delegates here. Keeping this module free of `sessionManager`
 * (which pulls in Electron `safeStorage`) is what makes the shell testable.
 *
 * We intentionally implement only the focused subset of the mongosh /
 * NoSQLBooster surface the user actually needs; gaps should surface as clear
 * errors, never silent wrong behavior (ADR-0003).
 */
import vm from 'node:vm'
import { ObjectId, Long, Int32, Decimal128, Binary, Timestamp, MinKey, MaxKey, UUID } from 'bson'
import { FindCursor, AggregationCursor } from 'mongodb'
import type { Collection, Db, Document, FindOptions } from 'mongodb'
import type { ShellOutputLine, ShellResult } from '../../shared/types'
import { serializerPool } from '../workers/serializerPool'

const DEFAULT_LIMIT = 50
const EXEC_TIMEOUT_MS = 30_000
/** Upper bound on captured print/printjson lines per run (ADR-0004 rule 2 in
    spirit: a `forEach(printjson)` over a huge cursor must not flood the IPC). */
export const MAX_OUTPUT_LINES = 1000

// ---------------------------------------------------------------------------
// Cursor prototype shims — mongosh / NoSQLBooster compatibility
// ---------------------------------------------------------------------------
// The Node driver's cursors lack a few helpers shell users reach for. We add
// them once, idempotently, on the prototypes. They return `this` (chainable) or
// a value, matching shell semantics. Patching the prototype (vs. wrapping each
// cursor) keeps chaining intact and costs nothing per query.

function patchSharedCursorMethods(proto: Record<string, unknown>): void {
  // `.pretty()` is a display affordance in the shell; here rendering is the
  // GUI's job, so it's a chainable no-op.
  if (typeof proto.pretty !== 'function') {
    proto.pretty = function pretty(this: unknown): unknown {
      return this
    }
  }
  // `.itcount()` / `.size()` materialize the cursor and report the count. The
  // user asked for this explicitly (unlike a bare cursor, which stays bounded).
  if (typeof proto.itcount !== 'function') {
    proto.itcount = async function itcount(
      this: { toArray(): Promise<unknown[]> }
    ): Promise<number> {
      return (await this.toArray()).length
    }
  }
  if (typeof proto.size !== 'function') {
    proto.size = function size(this: { itcount(): Promise<number> }): Promise<number> {
      return this.itcount()
    }
  }
}

const findCursorProto = FindCursor.prototype as unknown as Record<string, unknown>
// mongosh / NoSQLBooster expose `cursor.projection(spec)`; the driver only has
// `project(spec)`. Alias it so copied snippets run unchanged.
if (typeof findCursorProto.projection !== 'function') {
  findCursorProto.projection = function projection(this: FindCursor, spec: Document): FindCursor {
    return this.project(spec)
  }
}
patchSharedCursorMethods(findCursorProto)
patchSharedCursorMethods(AggregationCursor.prototype as unknown as Record<string, unknown>)

// ---------------------------------------------------------------------------
// Collection proxy — adapts shell-flavored calls to the driver
// ---------------------------------------------------------------------------

/**
 * mongosh's `find(query, projection)` / `findOne(query, projection)` take the
 * projection as the SECOND POSITIONAL argument, whereas the driver's second arg
 * is a `FindOptions` object. Translate so the common shell idiom
 * `db.coll.find({}, { name: 1, _id: 0 })` projects instead of silently
 * returning whole documents. An optional third arg is merged as driver options.
 */
function buildFindOptions(
  projection?: Document,
  options?: Document,
  signal?: AbortSignal
): FindOptions | undefined {
  if (!projection && !options && !signal) return undefined
  return {
    ...(options ?? {}),
    ...(projection ? { projection } : {}),
    ...(signal ? { signal } : {})
  } as FindOptions
}

/**
 * Merge an `AbortSignal` into an operation's options object (for cancellable
 * aggregate/command calls). A no-op when no signal is active, so non-cancellable
 * runs keep passing exactly what they passed before.
 */
function withSignal(options: Document | undefined, signal?: AbortSignal): Document | undefined {
  if (!signal) return options
  return { ...(options ?? {}), signal }
}

/**
 * Wrap a Collection so a handful of shell-only spellings work, while every
 * other method/property passes straight through to the real driver Collection.
 * `signal`, when present, is injected into the cursor-producing ops so a slow
 * find/aggregate can be cancelled server-side (the "Stop" button).
 */
function makeCollProxy(coll: Collection, signal?: AbortSignal): Collection {
  return new Proxy(coll, {
    get(target, prop, receiver) {
      if (typeof prop !== 'string') return Reflect.get(target, prop, receiver)
      switch (prop) {
        case 'find':
          return (filter?: Document, projection?: Document, options?: Document) =>
            target.find(filter ?? {}, buildFindOptions(projection, options, signal))
        case 'findOne':
          return (filter?: Document, projection?: Document, options?: Document) =>
            target.findOne(filter ?? {}, buildFindOptions(projection, options, signal))
        // Inject the signal so a runaway aggregation can be cancelled mid-flight.
        case 'aggregate':
          return (pipeline?: Document[], options?: Document) =>
            target.aggregate(pipeline ?? [], withSignal(options, signal))
        // mongosh `getIndexes()` → driver `indexes()`.
        case 'getIndexes':
          return () => target.indexes()
      }
      const val = (target as unknown as Record<string, unknown>)[prop]
      return typeof val === 'function' ? (val as (...a: unknown[]) => unknown).bind(target) : val
    }
  })
}

// ---------------------------------------------------------------------------
// db proxy (ADR-0003)
// ---------------------------------------------------------------------------

/**
 * Build the sandbox `db` object. `db.<name>` resolves to a (wrapped) real
 * Collection (so `db.lives.find()` works), genuine Db methods pass through, and
 * a set of mongosh-only `db` helpers are shimmed onto driver equivalents so
 * snippets copied from mongosh / NoSQLBooster run unchanged. Anything genuinely
 * unsupported surfaces as an error rather than silent wrong behavior.
 */
export function makeDbProxy(db: Db, signal?: AbortSignal): Db {
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (typeof prop !== 'string') return Reflect.get(target, prop, receiver)
      switch (prop) {
        case 'getCollection':
          return (name: string) => makeCollProxy(target.collection(name), signal)
        // Driver `db.collection(name)` also yields a wrapped collection so the
        // find/findOne projection shim applies regardless of spelling.
        case 'collection':
          return (name: string) => makeCollProxy(target.collection(name), signal)
        case 'getSiblingDB':
          return (name: string) => makeDbProxy(target.client.db(name), signal)
        // db-level aggregation (`db.aggregate([...])`) — cancellable too.
        case 'aggregate':
          return (pipeline?: Document[], options?: Document) =>
            target.aggregate(pipeline ?? [], withSignal(options, signal))
        // mongosh `db.runCommand(cmd)` → driver `db.command(cmd)`.
        case 'runCommand':
          return (cmd: Document) => target.command(cmd, withSignal(undefined, signal))
        // mongosh `db.adminCommand(cmd)` → `db.admin().command(cmd)`.
        case 'adminCommand':
          return (cmd: Document) => target.admin().command(cmd, withSignal(undefined, signal))
        case 'getCollectionNames':
          return () =>
            target
              .listCollections({}, { nameOnly: true })
              .toArray()
              .then((cs) => cs.map((c) => c.name))
        case 'getCollectionInfos':
          return (filter?: Document) => target.listCollections(filter ?? {}).toArray()
        case 'getName':
          return () => target.databaseName
        case 'version':
          return () =>
            target
              .admin()
              .command({ buildInfo: 1 })
              .then((r: Document) => r.version)
      }
      if (prop in target) {
        const val = (target as unknown as Record<string, unknown>)[prop]
        return typeof val === 'function' ? (val as (...a: unknown[]) => unknown).bind(target) : val
      }
      // Unknown property → treat as a collection name (mongosh: `db.<coll>`).
      return makeCollProxy(target.collection(prop))
    }
  })
}

/**
 * Wrap a BSON class so it works both as `ObjectId("…")` (mongo-shell style, no
 * `new`) and as `new ObjectId("…")`. Modern bson constructors are ES classes
 * that throw when called without `new`; the apply trap bridges that, while
 * statics (`ObjectId.isValid`, …) and `instanceof` pass through to the class.
 */
function callableCtor<T extends new (...args: never[]) => unknown>(Ctor: T): T {
  return new Proxy(Ctor, {
    apply: (target, _thisArg, args) => Reflect.construct(target, args as never[])
  })
}

/**
 * Collects raw print/printjson arguments during a run. Values are kept as-is
 * (they may be live BSON) and converted to wire-ready {@link ShellOutputLine}s
 * only once, after the run — the sandbox callbacks stay cheap and synchronous.
 */
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

export function makeSandbox(
  db: Db,
  signal?: AbortSignal,
  out?: OutputCollector
): Record<string, unknown> {
  const print = (...args: unknown[]): void => out?.push('print', args)
  return {
    db: makeDbProxy(db, signal),
    ObjectId: callableCtor(ObjectId),
    ISODate: (s?: string) => (s ? new Date(s) : new Date()),
    Date,
    NumberLong: (v: string | number) => Long.fromString(String(v)),
    // Shell `NumberInt` is a true 32-bit int, not a JS double.
    NumberInt: (v: string | number) => new Int32(parseInt(String(v), 10)),
    NumberDecimal: (v: string | number) => Decimal128.fromString(String(v)),
    UUID: (s?: string) => (s ? new UUID(s) : new UUID()),
    BinData: (subtype: number, base64: string) =>
      new Binary(Buffer.from(base64, 'base64'), subtype),
    // mongosh `Timestamp(t, i)` passes two numbers; bson's class wants a single
    // `{ t, i }` / Long / bigint. Bridge the two-arg form, default to (0, 0).
    Timestamp: (t?: number | Long | bigint | { t: number; i: number }, i?: number) => {
      if (t === undefined) return new Timestamp({ t: 0, i: 0 })
      if (typeof t === 'number') return new Timestamp({ t, i: i ?? 0 })
      if (typeof t === 'bigint') return new Timestamp(t)
      if (t instanceof Long) return new Timestamp(t)
      return new Timestamp(t)
    },
    MinKey: callableCtor(MinKey),
    MaxKey: callableCtor(MaxKey),
    // Shell print helpers feed the Console output (bounded; see MAX_OUTPUT_LINES).
    print,
    printjson: (v?: unknown) => out?.push('printjson', [v]),
    console: {
      log: print,
      info: print,
      error: (...args: unknown[]) => out?.push('print', args, 'error'),
      warn: (...args: unknown[]) => out?.push('print', args, 'warn')
    }
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
  limit: number,
  signal?: AbortSignal
): Promise<{ docs: unknown[]; truncated: boolean }> {
  const docs: unknown[] = []
  // Belt-and-suspenders cancellation: the signal is already threaded into the
  // find/aggregate op (so the driver rejects the in-flight getMore on abort),
  // but closing the cursor here also unblocks any op that ignored the signal —
  // the pending `next()` then rejects and we fall through to the abort branch.
  const onAbort = (): void => {
    void cursor.close?.().catch(() => {})
  }
  if (signal) signal.addEventListener('abort', onAbort, { once: true })
  try {
    if (signal?.aborted) throw signal.reason ?? new Error('Aborted')
    for await (const doc of cursor) {
      // Guard between batches: an abort that lands here (rather than mid-getMore,
      // which the driver signal / cursor close handle) bails immediately.
      if (signal?.aborted) throw signal.reason ?? new Error('Aborted')
      docs.push(doc)
      if (docs.length > limit) break // fetch one extra to detect truncation
    }
  } finally {
    if (signal) signal.removeEventListener('abort', onAbort)
  }
  const truncated = docs.length > limit
  if (truncated) docs.pop()
  await cursor.close?.().catch(() => {})
  return { docs, truncated }
}

/**
 * Reject as soon as `signal` aborts. Used to race a pending `await` so the UI
 * unblocks even for driver ops that don't honor the signal natively; the
 * orphaned operation settles later and its result is discarded.
 */
function abortRace(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    const fail = (): void => reject(signal.reason ?? new Error('Aborted'))
    if (signal.aborted) return fail()
    signal.addEventListener('abort', fail, { once: true })
  })
}

/** Await `p`, but bail out the moment `signal` aborts. */
function withAbort<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p
  // Keep the original promise's eventual rejection handled so racing past it
  // doesn't surface as an unhandledRejection.
  p.catch(() => {})
  return Promise.race([p, abortRace(signal)])
}

/** A driver write result (insert/update/delete/replace/bulkWrite). */
function isWriteAck(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false
  if ('acknowledged' in v) return true
  // BulkWriteResult carries no `acknowledged` field but is still a write summary.
  return (v as { constructor?: { name?: string } }).constructor?.name === 'BulkWriteResult'
}

/**
 * Errors thrown inside the `vm` sandbox come from a different realm, so
 * `instanceof Error` is false for them even though they carry the real
 * `name`/`message` (TypeError, ReferenceError, …). Duck-type instead, so the
 * renderer shows the true error name rather than a flattened "Error".
 */
export function describeError(err: unknown): { error: string; errorName: string } {
  if (err && typeof err === 'object') {
    const e = err as { name?: unknown; message?: unknown }
    const message = typeof e.message === 'string' ? e.message : undefined
    const name = typeof e.name === 'string' ? e.name : undefined
    if (message !== undefined || name !== undefined) {
      return { error: message ?? String(err), errorName: name ?? 'Error' }
    }
  }
  return { error: String(err), errorName: 'Error' }
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

export interface RunShellOptions {
  /** Default page size applied to bare cursors (ADR-0004 rule 2). */
  limit?: number
  /** Page offset injected into a FindCursor (prev/next paging). Ignored for
      non-find cursors — they can't skip without a pipeline stage. */
  skip?: number
  /** Run the query under explain('executionStats') instead of fetching docs. */
  explain?: boolean
  /** Cancellation handle. Threaded into find/aggregate/command ops for true
      server-side cancellation, and raced against pending awaits so the run
      bails promptly when the user hits "Stop". */
  signal?: AbortSignal
}

/**
 * Execute `code` against `db` in a `vm` sandbox and shape the completion value
 * into a {@link ShellResult}. The completion value of the script is the value
 * of its last expression (REPL semantics), so `db.coll.find({})` yields the
 * cursor, which we then drain to a bounded page.
 */
export async function runShellOnDb(
  db: Db,
  code: string,
  options: RunShellOptions = {}
): Promise<ShellResult> {
  const limit = options.limit ?? DEFAULT_LIMIT
  const signal = options.signal
  const started = Date.now()
  const collection = detectCollection(code)
  const out = new OutputCollector()
  // Attach whatever the script printed to the outgoing result — every kind,
  // including errors (the output produced before a failure is the best clue).
  const withOutput = async (r: ShellResult): Promise<ShellResult> => {
    if (out.size === 0) return r
    return { ...r, output: await out.toLines(), ...(out.truncated ? { outputTruncated: true } : {}) }
  }

  try {
    const sandbox = makeSandbox(db, signal, out)
    const context = vm.createContext(sandbox)
    const script = new vm.Script(code, { filename: 'shell.js' })
    // The synchronous body is bounded by the vm timeout; a runaway sync loop
    // can't be interrupted by the signal (it never yields to the event loop).
    let result: unknown = script.runInContext(context, { timeout: EXEC_TIMEOUT_MS })

    // Unwrap a returned promise (findOne, updateOne, countDocuments, …).
    if (result && typeof (result as { then?: unknown }).then === 'function') {
      result = await withAbort(result as Promise<unknown>, signal)
    }

    // Explain path: don't fetch — run explain('executionStats') on the cursor.
    if (options.explain) {
      if (isExplainable(result)) {
        const plan = await withAbort(result.explain('executionStats'), signal)
        return await withOutput({
          kind: 'explain',
          data: await serializerPool.serializeOne(plan),
          collection,
          elapsedMs: Date.now() - started
        })
      }
      return await withOutput({
        kind: 'error',
        error: 'Explain is only supported for find()/aggregate() queries.',
        errorName: 'ExplainError',
        collection,
        elapsedMs: Date.now() - started
      })
    }

    const elapsedMs = Date.now() - started

    if (isCursor(result)) {
      // Only a FindCursor can be re-paged via skip; aggregation/command cursors
      // can't (skip would need a $skip stage). For those we just report
      // pageable: false and the UI falls back to raising the page size.
      const pageable = result instanceof FindCursor
      const skip = options.skip ?? 0
      if (pageable && skip > 0) (result as FindCursor).skip(skip)
      const { docs, truncated } = await drainCursor(result, limit, signal)
      return await withOutput({
        kind: 'documents',
        data: await serializerPool.serialize(docs),
        count: docs.length,
        truncated,
        pageable,
        skip,
        collection,
        elapsedMs: Date.now() - started
      })
    }

    if (Array.isArray(result)) {
      return await withOutput({
        kind: 'documents',
        data: await serializerPool.serialize(result),
        count: result.length,
        truncated: false,
        collection,
        elapsedMs
      })
    }

    if (isWriteAck(result)) {
      return await withOutput({
        kind: 'ack',
        data: await serializerPool.serializeOne(result),
        collection,
        elapsedMs
      })
    }

    return await withOutput({
      kind: 'value',
      data: await serializerPool.serializeOne(result ?? null),
      collection,
      elapsedMs
    })
  } catch (err) {
    // A user-initiated stop surfaces as whatever the driver/race threw; collapse
    // all of them to one clean "Aborted" result rather than a scary stack.
    if (signal?.aborted) {
      return await withOutput({
        kind: 'error',
        error: '执行已停止',
        errorName: 'Aborted',
        collection,
        elapsedMs: Date.now() - started
      })
    }
    const { error, errorName } = describeError(err)
    return await withOutput({
      kind: 'error',
      error,
      errorName,
      collection,
      elapsedMs: Date.now() - started
    })
  }
}
