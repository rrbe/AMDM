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
import AsyncWriterModule from '@mongosh/async-rewriter2'
import { parse as parseJs } from '@babel/parser'

// CJS/ESM interop differs between vitest (applies default-unwrapping) and the
// electron-vite main bundle (bare `require`, no unwrapping) — resolve the
// class from either shape explicitly so both runtimes construct the same thing.
const AsyncWriter =
  (AsyncWriterModule as unknown as { default?: typeof AsyncWriterModule }).default ??
  AsyncWriterModule
import { ObjectId, Long, Int32, Decimal128, Binary, Timestamp, MinKey, MaxKey, UUID } from 'bson'
import { FindCursor, AggregationCursor, AbstractCursor } from 'mongodb'
import type { Collection, Db, Document, FindOptions } from 'mongodb'
import type { ShellOutputLine, ShellResult } from '../../shared/types'
import { serializerPool } from '../workers/serializerPool'

const DEFAULT_LIMIT = 50
const EXEC_TIMEOUT_MS = 30_000
/** Upper bound on captured print/printjson lines per run (ADR-0004 rule 2 in
    spirit: a `forEach(printjson)` over a huge cursor must not flood the IPC). */
export const MAX_OUTPUT_LINES = 1000

// ---------------------------------------------------------------------------
// Implicit await (mongosh async-rewriter2)
// ---------------------------------------------------------------------------
// Multi-step scripts copied from mongosh / NoSQLBooster don't write `await`:
// `const ids = db.cards.distinct(...)` expects an array, not a Promise. We run
// user code through mongosh's own transpiler, which rewrites every expression
// so that values tagged with the shared-registry symbol below are implicitly
// awaited. Our proxies/prototype patches tag every driver promise; plain user
// promises stay untouched unless explicitly `await`ed (top-level await works).

const SYNTHETIC_PROMISE = Symbol.for('@@mongosh.syntheticPromise')

function isThenable(v: unknown): v is PromiseLike<unknown> {
  return (
    v !== null &&
    (typeof v === 'object' || typeof v === 'function') &&
    typeof (v as { then?: unknown }).then === 'function'
  )
}

// The prototype patches below are global (cursors escape the shell proxies, so
// the tag has to live on shared driver prototypes), but their BEHAVIOR is
// scoped: outside a shell run they degrade to tag-in-place / native-driver
// paths, so other main-process callers on the same prototypes (catalog,
// exporter, …) keep pristine driver semantics — e.g. `docs.map(async …)` +
// `Promise.all` there must NOT hit the sequential-await arrays. A concurrent
// catalog call DURING a shell run still sees the enhanced behavior (module
// counter, not per-async-context), which is harmless: the array helpers are
// inert for sync callbacks.
let activeShellRuns = 0

/** Run `fn` with shell semantics active (async-aware arrays, awaiting cursor
    forEach). `runShellOnDb` wraps itself in this; exported for unit tests. */
export async function shellRunScope<T>(fn: () => Promise<T>): Promise<T> {
  activeShellRuns++
  try {
    return await fn()
  } finally {
    activeShellRuns--
  }
}

/** Tag a thenable so the transpiled code implicitly awaits it. Non-thenables
    pass through untouched; tagging is idempotent. The symbol comes from the
    cross-realm registry, so the check inside the `vm` realm sees the same
    symbol. During a shell run, thenables are re-wrapped (not mutated) so that
    resolved ARRAYS gain the async-aware iteration helpers below before user
    code ever sees them; outside one they are tagged in place — same promise
    identity, no array enhancement. */
export function markSyntheticPromise<T>(value: T): T {
  if (!isThenable(value)) return value
  if ((value as Record<symbol, unknown>)[SYNTHETIC_PROMISE]) return value
  if (activeShellRuns === 0) {
    Object.defineProperty(value, SYNTHETIC_PROMISE, { value: true })
    return value
  }
  const chained = Promise.resolve(value).then((v) =>
    Array.isArray(v) ? patchAsyncAwareArray(v) : v
  )
  Object.defineProperty(chained, SYNTHETIC_PROMISE, { value: true })
  return chained as unknown as T
}

// ---------------------------------------------------------------------------
// Async-aware array iteration (NoSQLBooster / mongosh script compatibility)
// ---------------------------------------------------------------------------
// async-rewriter2 rewrites user CALLBACKS too: a callback that touches the db
// (`names.forEach(n => print(db[n].countDocuments()))`) suspends at its first
// driver call and returns a promise — which the NATIVE Array.prototype methods
// neither await nor surface. The script then "finishes" before the callbacks
// run (prints lost, result null), or `map` yields an array of pending promises
// (`JSON.stringify(rows)` → `[{}, {}]`). NoSQLBooster's fiber-based shell is
// fully synchronous, so snippets copied from it lean on this pattern heavily.
// Fix: arrays resolved from tagged driver promises (getCollectionNames,
// getCollectionInfos, toArray, distinct, …) get OWN forEach/map/… that run the
// callbacks sequentially, await any thenable result, and return a tagged
// promise the implicit await then unwraps. Sync callbacks keep exact native
// behavior (and native return types).
//
// Boundaries:
// - Covered: forEach / map / flatMap / filter / find / findIndex / some /
//   every / reduce / reduceRight. `sort`/`toSorted` cannot be made async-aware
//   (a comparator has no sequential-await order), so a comparator returning a
//   thenable THROWS instead of silently misordering (ADR-0003: loud, never
//   silent). Anything else with a callback (e.g. `findLast`) falls through to
//   the native, async-unaware method.
// - Plain array literals are NOT patched — same limitation as mongosh itself.
// - Enhancement only happens during a shell run (`activeShellRuns` above);
//   catalog/exporter and other main-process driver callers get raw arrays.
// - The driver CURSOR's own `forEach` has the same fire-without-await flaw;
//   it is replaced separately below (see the AbstractCursor.forEach patch).

const ASYNC_AWARE_ARRAY = Symbol('amdm.asyncAwareArray')

type ArrayCb = (value: unknown, index: number, array: unknown[]) => unknown

/** Sequentially collect cb(item) for every item. Fully synchronous until the
    first thenable result, then switches to awaiting (order preserved). Length
    is captured up front, like the native methods (a callback that pushes new
    elements doesn't extend the iteration). */
function collectSeq(
  arr: unknown[],
  cb: ArrayCb,
  thisArg?: unknown
): unknown[] | Promise<unknown[]> {
  const len = arr.length
  const results = new Array(len)
  for (let i = 0; i < len; i++) {
    const r = cb.call(thisArg, arr[i], i, arr)
    if (isThenable(r)) {
      return (async () => {
        results[i] = await r
        for (let j = i + 1; j < len; j++) {
          results[j] = await cb.call(thisArg, arr[j], j, arr)
        }
        return results
      })()
    }
    results[i] = r
  }
  return results
}

/** Index of the first element whose predicate result coerces to `stopOn`
    (early exit), or -1. Same sync-until-first-thenable strategy. */
function findIndexSeq(
  arr: unknown[],
  pred: ArrayCb,
  thisArg: unknown,
  stopOn: boolean
): number | Promise<number> {
  const len = arr.length
  for (let i = 0; i < len; i++) {
    const r = pred.call(thisArg, arr[i], i, arr)
    if (isThenable(r)) {
      return (async () => {
        if (Boolean(await r) === stopOn) return i
        for (let j = i + 1; j < len; j++) {
          if (Boolean(await pred.call(thisArg, arr[j], j, arr)) === stopOn) return j
        }
        return -1
      })()
    }
    if (Boolean(r) === stopOn) return i
  }
  return -1
}

/** Install own, non-enumerable async-aware iteration methods on `arr`.
    Idempotent; invisible to JSON.stringify / BSON / structuredClone (all skip
    non-enumerable props), so the array still serializes as a plain array. */
export function patchAsyncAwareArray<T extends unknown[]>(arr: T): T {
  if ((arr as Record<symbol, unknown>)[ASYNC_AWARE_ARRAY] || !Object.isExtensible(arr)) return arr
  Object.defineProperty(arr, ASYNC_AWARE_ARRAY, { value: true })
  const a = arr as unknown[]
  const define = (name: string, fn: unknown): void => {
    Object.defineProperty(arr, name, { value: fn, writable: true, configurable: true })
  }

  define('forEach', (cb: ArrayCb, thisArg?: unknown): unknown => {
    const r = collectSeq(a, cb, thisArg)
    return isThenable(r) ? markSyntheticPromise(r.then(() => undefined)) : undefined
  })
  define('map', (cb: ArrayCb, thisArg?: unknown): unknown => {
    const r = collectSeq(a, cb, thisArg)
    // Derived arrays stay enhanced by LINEAGE (the source array is enhanced),
    // not by scope — patch explicitly on both paths instead of relying on
    // markSyntheticPromise's scoped patching.
    return isThenable(r)
      ? markSyntheticPromise((r as Promise<unknown[]>).then((vals) => patchAsyncAwareArray(vals)))
      : patchAsyncAwareArray(r as unknown[])
  })
  define('flatMap', (cb: ArrayCb, thisArg?: unknown): unknown => {
    const flat = (vals: unknown[]): unknown[] => patchAsyncAwareArray(vals.flat())
    const r = collectSeq(a, cb, thisArg)
    return isThenable(r)
      ? markSyntheticPromise((r as Promise<unknown[]>).then(flat))
      : flat(r as unknown[])
  })
  define('filter', (cb: ArrayCb, thisArg?: unknown): unknown => {
    const pick = (flags: unknown[]): unknown[] => {
      const out: unknown[] = []
      // flags.length is the length captured before iteration — elements the
      // callbacks appended are excluded, matching the native methods.
      for (let i = 0; i < flags.length; i++) if (flags[i]) out.push(a[i])
      return patchAsyncAwareArray(out)
    }
    const flags = collectSeq(a, cb, thisArg)
    return isThenable(flags)
      ? markSyntheticPromise((flags as Promise<unknown[]>).then(pick))
      : pick(flags as unknown[])
  })
  define('find', (cb: ArrayCb, thisArg?: unknown): unknown => {
    const i = findIndexSeq(a, cb, thisArg, true)
    return isThenable(i)
      ? markSyntheticPromise((i as Promise<number>).then((ix) => (ix === -1 ? undefined : a[ix])))
      : i === -1
        ? undefined
        : a[i as number]
  })
  define('findIndex', (cb: ArrayCb, thisArg?: unknown): unknown => {
    const i = findIndexSeq(a, cb, thisArg, true)
    return isThenable(i) ? markSyntheticPromise(i) : i
  })
  define('some', (cb: ArrayCb, thisArg?: unknown): unknown => {
    const i = findIndexSeq(a, cb, thisArg, true)
    return isThenable(i)
      ? markSyntheticPromise((i as Promise<number>).then((ix) => ix !== -1))
      : i !== -1
  })
  define('every', (cb: ArrayCb, thisArg?: unknown): unknown => {
    const i = findIndexSeq(a, cb, thisArg, false)
    return isThenable(i)
      ? markSyntheticPromise((i as Promise<number>).then((ix) => ix === -1))
      : i === -1
  })
  define(
    'reduce',
    (cb: (acc: unknown, v: unknown, i: number, arr: unknown[]) => unknown, ...init: unknown[]): unknown => {
      const len = a.length
      let acc: unknown
      let start: number
      if (init.length > 0) {
        acc = init[0]
        start = 0
      } else if (len === 0) {
        throw new TypeError('Reduce of empty array with no initial value')
      } else {
        acc = a[0]
        start = 1
      }
      for (let i = start; i < len; i++) {
        const r = cb(acc, a[i], i, a)
        if (isThenable(r)) {
          return markSyntheticPromise(
            (async () => {
              acc = await r
              for (let j = i + 1; j < len; j++) acc = await cb(acc, a[j], j, a)
              return acc
            })()
          )
        }
        acc = r
      }
      return acc
    }
  )
  define(
    'reduceRight',
    (cb: (acc: unknown, v: unknown, i: number, arr: unknown[]) => unknown, ...init: unknown[]): unknown => {
      const len = a.length
      let acc: unknown
      let start: number
      if (init.length > 0) {
        acc = init[0]
        start = len - 1
      } else if (len === 0) {
        throw new TypeError('Reduce of empty array with no initial value')
      } else {
        acc = a[len - 1]
        start = len - 2
      }
      for (let i = start; i >= 0; i--) {
        const r = cb(acc, a[i], i, a)
        if (isThenable(r)) {
          return markSyntheticPromise(
            (async () => {
              acc = await r
              for (let j = i - 1; j >= 0; j--) acc = await cb(acc, a[j], j, a)
              return acc
            })()
          )
        }
        acc = r
      }
      return acc
    }
  )
  // A db-touching comparator (rewritten to return a promise) would make the
  // NATIVE sort coerce promises to NaN and "succeed" with garbage order —
  // exactly the silent-wrong ADR-0003 forbids. Throw with a way out instead.
  const guardComparator =
    (cmp: (x: unknown, y: unknown) => unknown) =>
    (x: unknown, y: unknown): number => {
      const r = cmp(x, y)
      if (isThenable(r)) {
        // The in-flight promise is abandoned on purpose; keep its eventual
        // rejection handled (e.g. client closed before it settles) so it
        // can't surface as an unhandledRejection.
        void r.then(undefined, () => {})
        throw new TypeError(
          'sort() comparator returned a Promise — db calls inside a comparator are not supported; compute the sort keys first (e.g. map to { key, doc }), then sort'
        )
      }
      return r as number
    }
  define('sort', (cmp?: (x: unknown, y: unknown) => unknown): unknown =>
    Array.prototype.sort.call(a, typeof cmp === 'function' ? guardComparator(cmp) : undefined)
  )
  const nativeToSorted = (Array.prototype as unknown as Record<string, unknown>).toSorted
  if (typeof nativeToSorted === 'function') {
    define('toSorted', (cmp?: (x: unknown, y: unknown) => unknown): unknown =>
      patchAsyncAwareArray(
        (nativeToSorted as (this: unknown, c?: unknown) => unknown[]).call(
          a,
          typeof cmp === 'function' ? guardComparator(cmp) : undefined
        )
      )
    )
  }
  return arr
}

const asyncWriter = new AsyncWriter()
/** Per-code transpile cache — paging/refresh re-run the same code verbatim,
    and Babel costs ~25–80ms per pass. Tiny FIFO, keyed by the exact source. */
const transpileCache = new Map<string, string>()
const TRANSPILE_CACHE_MAX = 50

/**
 * async-rewriter2 parses as sourceType 'script', so explicit TOP-LEVEL `await`
 * is a SyntaxError there (mongosh sits inside the Node REPL, which pre-wraps).
 * When that exact error appears, wrap the program in an async IIFE — keeping
 * REPL completion-value semantics by `return`ing the last expression statement
 * — and transpile the wrapper instead (implicit await still applies inside).
 */
function wrapTopLevelAwait(code: string): string {
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

export function transpileShellCode(code: string): string {
  const hit = transpileCache.get(code)
  if (hit !== undefined) return hit
  let out: string
  try {
    out = asyncWriter.process(code)
  } catch (err) {
    if (err instanceof SyntaxError && /'await' is only allowed/.test(err.message)) {
      out = asyncWriter.process(wrapTopLevelAwait(code))
    } else {
      throw err
    }
  }
  if (transpileCache.size >= TRANSPILE_CACHE_MAX) {
    transpileCache.delete(transpileCache.keys().next().value as string)
  }
  transpileCache.set(code, out)
  return out
}

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

// The driver's `cursor.forEach` fires the iterator WITHOUT awaiting its result
// (`iterator(document)` in abstract_cursor.js) — so a rewritten, db-touching
// callback in `db.x.find().forEach(...)` races past the end of the run, the
// same failure mode the async-aware ARRAY methods above fix. mongosh's shell
// cursor awaits each callback; replace the method to match. Sync callbacks
// keep exact driver semantics (stop on `=== false`), thenable results are
// awaited in document order. Outside a shell run the replacement delegates to
// the driver's own implementation (see `activeShellRuns`). Must run BEFORE
// tagPromiseMethods below so the replacement gets the synthetic-promise
// wrapper too.
// The idempotency marker lives on the PROTOTYPE (shared-registry symbol), not
// on the function: tagPromiseMethods wraps forEach right below, so a flag on
// the function itself would be hidden behind the wrapper and a re-evaluation
// of this module would needlessly re-replace the method.
const CURSOR_FOREACH_PATCHED = Symbol.for('amdm.cursorForEachAwaits')
const abstractCursorProto = AbstractCursor.prototype as unknown as Record<
  string | symbol,
  unknown
>
if (!abstractCursorProto[CURSOR_FOREACH_PATCHED]) {
  Object.defineProperty(abstractCursorProto, CURSOR_FOREACH_PATCHED, { value: true })
  const origForEach = abstractCursorProto.forEach as (
    this: unknown,
    iterator: (doc: unknown) => unknown
  ) => Promise<void>
  const forEach = async function forEach(
    this: AsyncIterable<unknown>,
    iterator: (doc: unknown) => unknown
  ): Promise<void> {
    if (activeShellRuns === 0) return origForEach.call(this, iterator)
    if (typeof iterator !== 'function') {
      throw new TypeError('Argument "iterator" must be a function')
    }
    for await (const doc of this) {
      let r = iterator(doc)
      if (isThenable(r)) r = await r
      if (r === false) break
    }
  }
  abstractCursorProto.forEach = forEach
}

/**
 * Wrap the promise-returning methods of a prototype so their results carry the
 * synthetic-promise tag (implicit await). Cursors escape our proxies — a chain
 * like `db.x.find().sort(..).toArray()` calls `toArray` on the raw driver
 * cursor — so the tag has to live on the prototypes. Idempotent via a flag on
 * the wrapper. Other callers (catalog etc.) that share these prototypes run
 * outside a shell scope, so markSyntheticPromise tags their promises in place —
 * same promise identity, no array enhancement (see activeShellRuns above).
 */
function tagPromiseMethods(proto: Record<string, unknown>, names: string[]): void {
  for (const name of names) {
    const orig = proto[name]
    if (typeof orig !== 'function') continue
    if ((orig as { __amdmTagged?: boolean }).__amdmTagged) continue
    const wrapped = function (this: unknown, ...args: unknown[]): unknown {
      return markSyntheticPromise((orig as (...a: unknown[]) => unknown).apply(this, args))
    }
    ;(wrapped as { __amdmTagged?: boolean }).__amdmTagged = true
    proto[name] = wrapped
  }
}

// Order matters: AbstractCursor first, so the Find/Agg pass sees the inherited
// methods already flagged and only wraps their own additions (explain, count,
// and the itcount/size shims defined above).
tagPromiseMethods(AbstractCursor.prototype as unknown as Record<string, unknown>, [
  'toArray',
  'forEach',
  'next',
  'tryNext',
  'hasNext',
  'close'
])
for (const proto of [findCursorProto, AggregationCursor.prototype as unknown as Record<string, unknown>]) {
  tagPromiseMethods(proto, ['toArray', 'forEach', 'explain', 'count', 'itcount', 'size'])
}

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
            markSyntheticPromise(
              target.findOne(filter ?? {}, buildFindOptions(projection, options, signal))
            )
        // Inject the signal so a runaway aggregation can be cancelled mid-flight.
        case 'aggregate':
          return (pipeline?: Document[], options?: Document) =>
            target.aggregate(pipeline ?? [], withSignal(options, signal))
        // mongosh `getIndexes()` → driver `indexes()`.
        case 'getIndexes':
          return () => markSyntheticPromise(target.indexes())
      }
      const val = (target as unknown as Record<string, unknown>)[prop]
      // Pass-through methods (distinct, countDocuments, insertOne, …): tag the
      // returned promise so multi-step scripts get the value, not the Promise.
      return typeof val === 'function'
        ? (...args: unknown[]) =>
            markSyntheticPromise((val as (...a: unknown[]) => unknown).apply(target, args))
        : val
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
          return (cmd: Document) =>
            markSyntheticPromise(target.command(cmd, withSignal(undefined, signal)))
        // mongosh `db.adminCommand(cmd)` → `db.admin().command(cmd)`.
        case 'adminCommand':
          return (cmd: Document) =>
            markSyntheticPromise(target.admin().command(cmd, withSignal(undefined, signal)))
        case 'getCollectionNames':
          return () =>
            markSyntheticPromise(
              target
                .listCollections({}, { nameOnly: true })
                .toArray()
                .then((cs) => cs.map((c) => c.name))
            )
        case 'getCollectionInfos':
          return (filter?: Document) =>
            markSyntheticPromise(target.listCollections(filter ?? {}).toArray())
        case 'getName':
          return () => target.databaseName
        case 'version':
          return () =>
            markSyntheticPromise(
              target
                .admin()
                .command({ buildInfo: 1 })
                .then((r: Document) => r.version)
            )
      }
      if (prop in target) {
        const val = (target as unknown as Record<string, unknown>)[prop]
        // Pass-through db methods (command, stats, dropDatabase, …): tag the
        // returned promise for implicit await; sync values pass unchanged.
        return typeof val === 'function'
          ? (...args: unknown[]) =>
              markSyntheticPromise((val as (...a: unknown[]) => unknown).apply(target, args))
          : val
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
 * cursor, which we then drain to a bounded page. Driver calls are implicitly
 * awaited (async-rewriter2, see above), so mongosh-style multi-step scripts
 * run without explicit `await`; top-level `await` also works.
 */
export async function runShellOnDb(
  db: Db,
  code: string,
  options: RunShellOptions = {}
): Promise<ShellResult> {
  // Everything below runs with shell semantics active: driver promises get
  // re-wrapped, resolved arrays get the async-aware helpers, and the cursor
  // forEach awaits callbacks (all scoped via activeShellRuns).
  return shellRunScope(() => runShellOnDbImpl(db, code, options))
}

async function runShellOnDbImpl(
  db: Db,
  code: string,
  options: RunShellOptions
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
    // Implicit await: run the async-rewriter2 transpilation of the user code.
    // Driver promises (tagged by our proxies/prototype patches) are awaited at
    // every step, so multi-statement scripts sequence naturally; the program's
    // completion value keeps REPL semantics (the last expression).
    const script = new vm.Script(transpileShellCode(code), { filename: 'shell.js' })
    // The synchronous prefix is bounded by the vm timeout; a runaway sync loop
    // can't be interrupted by the signal (it never yields to the event loop).
    let result: unknown = script.runInContext(context, { timeout: EXEC_TIMEOUT_MS })

    // The transpiled program returns a promise once any async step is hit;
    // race it against the abort signal so Stop unblocks mid-script.
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
