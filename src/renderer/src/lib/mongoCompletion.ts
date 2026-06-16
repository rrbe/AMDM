/**
 * CodeMirror 6 completion source for the mongo shell editor — the regex engine.
 * It owns the "MQL-string space" the TS language service can't see (operators &
 * values inside Document literals, field names) and is the transparent fallback
 * for member access when the TS worker is unavailable (see `shellCompletion.ts`).
 *
 * Decides suggestions from the text immediately before the cursor:
 *  - `db.<word>`           → collection names (active db) + Db methods
 *  - `db.<coll>.<word>`    → collection methods (+ warms the field cache)
 *  - `).<word>`            → cursor methods (sort/limit/toArray/…)
 *  - `<field>: <value>`    → value candidates for the slot we're in
 *                           (sort→1/-1, projection→1/0, boolean keys→true/false)
 *  - `$<word>`             → MongoDB operators, scoped to the call we're inside
 *  - otherwise             → shell globals + JS keywords/literals + field names
 *
 * The completion *data* (operators, globals, keywords, value tables) lives in
 * `completionRegistry.ts`; this file is the matching/decision logic.
 *
 * Robustness: reads the live store outside React; never throws (returns null).
 */
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { useAppStore, getActiveTab } from '@renderer/store/useAppStore'
import {
  operatorGroups,
  SHELL_GLOBALS,
  JS_LITERALS,
  JS_KEYWORDS,
  SORT_VALUES,
  PROJECTION_VALUES,
  BOOLEAN_VALUES,
  BOOLEAN_KEYS,
  type OpContext,
  type ValueChoice
} from '@renderer/lib/completionRegistry'

// --------------------------------------------------------------------------
// Method vocabularies — the regex-fallback path. The TS engine is the primary
// source for member access; these mirror the base d.ts subset so completion
// still works (less precisely) when the worker is unavailable.
// --------------------------------------------------------------------------

const DB_METHODS = ['getCollection', 'getSiblingDB', 'aggregate', 'runCommand', 'stats', 'listCollections']

const COLLECTION_METHODS = [
  'find', 'findOne', 'aggregate', 'countDocuments', 'estimatedDocumentCount', 'count', 'distinct',
  'insertOne', 'insertMany', 'updateOne', 'updateMany', 'replaceOne', 'deleteOne', 'deleteMany',
  'findOneAndUpdate', 'findOneAndReplace', 'findOneAndDelete', 'bulkWrite',
  'createIndex', 'createIndexes', 'dropIndex', 'dropIndexes', 'indexes', 'listIndexes',
  'drop', 'rename', 'watch', 'mapReduce'
]

const CURSOR_METHODS = [
  'sort', 'limit', 'skip', 'project', 'projection', 'count', 'toArray', 'forEach', 'map',
  'hasNext', 'next', 'explain', 'pretty', 'hint', 'collation', 'comment', 'batchSize', 'size',
  'allowDiskUse', 'maxTimeMS', 'min', 'max', 'returnKey', 'showRecordId', 'tailable', 'addCursorFlag'
]

// --------------------------------------------------------------------------
// Option builders
// --------------------------------------------------------------------------

function opt(label: string, type: Completion['type'], detail: string, boost?: number): Completion {
  return boost === undefined ? { label, type, detail } : { label, type, detail, boost }
}

/**
 * Length-based boost so shorter, closer matches win ties. CodeMirror adds boost
 * directly to the fuzzy score (`match.score + boost`), and in 6.x a pure prefix
 * match scores a flat −100 regardless of label length — so without this, equal
 * prefixes (e.g. `live` → `lives` vs `liveauthorizedviewers`) tie and fall back
 * to alphabetical order, burying the closer match. Shorter label → higher boost;
 * kept within [−99, 99] so it only reorders the prefix-tie band, never promotes
 * a scattered match above a prefix one.
 */
export function lengthBoost(label: string): number {
  return Math.max(-99, 99 - label.length)
}

/** Which collection method's call are we currently (innermost) inside? */
function detectCallContext(before: string): OpContext | null {
  const re =
    /\.(aggregate|find|findOne|updateOne|updateMany|update|replaceOne|findOneAndUpdate|findOneAndReplace|findOneAndDelete|deleteOne|deleteMany|countDocuments|count|distinct|bulkWrite)\s*\(/g
  let m: RegExpExecArray | null
  let last: string | undefined
  while ((m = re.exec(before)) !== null) last = m[1]
  if (!last) return null
  if (last === 'aggregate') return 'aggregate'
  if (['updateOne', 'updateMany', 'update', 'replaceOne', 'findOneAndUpdate', 'findOneAndReplace', 'bulkWrite'].includes(last)) {
    return 'update'
  }
  return 'query'
}

/** Operator completions scoped to the enclosing call (union if unknown). */
function operatorCompletions(before: string): Completion[] {
  const map = new Map<string, Completion>()
  for (const group of operatorGroups(detectCallContext(before))) {
    for (const l of group.labels) if (!map.has(l)) map.set(l, opt(l, 'property', group.detail))
  }
  return [...map.values()]
}

export function activeContext(): { connId: string; db: string } | null {
  const s = useAppStore.getState()
  const db = getActiveTab(s).activeDatabase
  if (!s.activeConnectionId || !db) return null
  return { connId: s.activeConnectionId, db }
}

export function collectionNames(connId: string, db: string): string[] {
  return (useAppStore.getState().catalogs[connId]?.collections[db] ?? []).map((c) => c.name)
}

/** Collection of the last `db.<coll>.` reference (what the user works against). */
function lastReferencedCollection(code: string): string | undefined {
  const re = /\bdb\.([A-Za-z_$][\w$]*)\./g
  let m: RegExpExecArray | null
  let last: string | undefined
  while ((m = re.exec(code)) !== null) last = m[1]
  return last
}

// --------------------------------------------------------------------------
// Value-slot detection (shared with the inline ghost-text hint)
// --------------------------------------------------------------------------

/** Is the cursor sitting inside an unterminated string literal? (heuristic) */
export function inString(before: string): boolean {
  let dq = 0
  let sq = 0
  for (let i = 0; i < before.length; i++) {
    const c = before[i]
    if (c === '\\') {
      i++ // skip the escaped char
      continue
    }
    if (c === '"') dq++
    else if (c === "'") sq++
  }
  return dq % 2 === 1 || sq % 2 === 1
}

/**
 * If the cursor is right after `<key>:` (a value slot, nothing typed yet),
 * return the key (quotes stripped); else null. Bails inside string literals so
 * `{ note: "a: ` doesn't look like a value slot.
 */
export function atValueSlot(before: string): string | null {
  if (inString(before)) return null
  const m = /([A-Za-z_$][\w$.]*|"[^"]+"|'[^']+')\s*:\s*$/.exec(before)
  if (!m) return null
  return m[1].replace(/^["']|["']$/g, '')
}

/** Are we inside a `sort({ … })` spec or a `$sort: { … }` stage body? */
export function isInsideSort(before: string): boolean {
  return /\.sort\s*\(\s*\{[^{}]*$/.test(before) || /\$sort\s*:\s*\{[^{}]*$/.test(before)
}

/** Are we inside a projection — `find(filter, { … })` or `$project: { … }`? */
export function isInsideProjection(before: string): boolean {
  if (/\.find\s*\(\s*(\{[^{}]*\})?\s*,\s*\{[^{}]*$/.test(before)) return true
  if (/\$project\s*:\s*\{[^{}]*$/.test(before)) return true
  return false
}

/** Value candidates for the slot we're in, or [] when not at a value slot. */
function computeValueOptions(before: string): Completion[] {
  const key = atValueSlot(before)
  if (key == null) return []
  const toOpts = (vs: ValueChoice[]): Completion[] => vs.map((v) => opt(v.label, 'text', v.detail))
  if (isInsideSort(before)) return toOpts(SORT_VALUES)
  if (isInsideProjection(before)) return toOpts(PROJECTION_VALUES)
  if (BOOLEAN_KEYS.has(key)) return toOpts(BOOLEAN_VALUES)
  return []
}

// --------------------------------------------------------------------------
// The pure decision core
// --------------------------------------------------------------------------

/** Everything the pure core needs, resolved by the wrapper from the store. */
export interface CompletionData {
  /** Collection names for the active db. */
  collections: string[]
  /** Cached field names for the last-referenced collection. */
  fields: string[]
}

export interface ShellCompletionResult {
  from: number
  options: Completion[]
  validFor: RegExp
}

/**
 * Pure: decide shell completions from the text before the cursor + resolved
 * data. `pos` is the absolute cursor offset (== before.length when `before` is
 * the full text-before-cursor slice). Returns null when nothing applies.
 */
export function computeShellCompletion(
  before: string,
  pos: number,
  data: CompletionData
): ShellCompletionResult | null {
  // `db.<coll>.<word>` → collection methods
  const collMethod = /\bdb\.([A-Za-z_$][\w$]*)\.([\w$]*)$/.exec(before)
  if (collMethod) {
    const word = collMethod[2]
    return {
      from: pos - word.length,
      options: COLLECTION_METHODS.map((m) => opt(m, 'method', 'collection')),
      validFor: /^[\w$]*$/
    }
  }

  // `).<word>` → cursor chain methods
  const cursorMethod = /\)\s*\.([\w$]*)$/.exec(before)
  if (cursorMethod) {
    const word = cursorMethod[1]
    return {
      from: pos - word.length,
      options: CURSOR_METHODS.map((m) => opt(m, 'method', 'cursor')),
      validFor: /^[\w$]*$/
    }
  }

  // `db.<word>` → collection names + Db methods
  const dbMember = /\bdb\.([\w$]*)$/.exec(before)
  if (dbMember) {
    const word = dbMember[1]
    const options: Completion[] = []
    for (const name of data.collections) options.push(opt(name, 'class', 'collection', lengthBoost(name)))
    for (const m of DB_METHODS) options.push(opt(m, 'method', 'db'))
    return { from: pos - word.length, options, validFor: /^[\w$]*$/ }
  }

  // `<field>: <value>` → value candidates (inserted at the cursor)
  const valueOptions = computeValueOptions(before)
  if (valueOptions.length) {
    return { from: pos, options: valueOptions, validFor: /^[\w$-]*$/ }
  }

  // `$<word>` → operators (scoped to the enclosing call)
  const dollar = /(\$[\w$]*)$/.exec(before)
  if (dollar) {
    const word = dollar[1]
    return { from: pos - word.length, options: operatorCompletions(before), validFor: /^\$[\w$]*$/ }
  }

  // otherwise → globals + literals + keywords + cached field names
  const wordMatch = /([\w$]*)$/.exec(before)
  const word = wordMatch ? wordMatch[1] : ''
  const options: Completion[] = []
  for (const g of SHELL_GLOBALS) options.push(opt(g, 'keyword', 'constructor'))
  for (const kw of JS_LITERALS) options.push(opt(kw, 'keyword', 'literal'))
  for (const kw of JS_KEYWORDS) options.push(opt(kw, 'keyword', 'keyword'))
  for (const f of data.fields) options.push(opt(f, 'variable', 'field', lengthBoost(f)))
  if (options.length === 0) return null
  return { from: pos - word.length, options, validFor: /^[\w$]*$/ }
}

// --------------------------------------------------------------------------
// The source (thin store-reading wrapper around the pure core)
// --------------------------------------------------------------------------

export function mongoCompletionSource(context: CompletionContext): CompletionResult | null {
  try {
    const token = context.matchBefore(/[\w$.]*/)
    if ((!token || token.from === token.to) && !context.explicit) return null

    const before = context.state.sliceDoc(0, context.pos)
    const ctx = activeContext()

    // Resolve the collection whose fields we'd complete: the `db.<coll>.` being
    // typed, else the last one referenced. Warm its field cache (side effect
    // kept out of the pure core) and read whatever's cached for the fallback.
    let fields: string[] = []
    if (ctx) {
      const coll =
        /\bdb\.([A-Za-z_$][\w$]*)\.[\w$]*$/.exec(before)?.[1] ?? lastReferencedCollection(before)
      if (coll) {
        void useAppStore.getState().sampleFields(ctx.connId, ctx.db, coll)
        fields = useAppStore.getState().getFields(ctx.connId, ctx.db, coll)
      }
    }

    const data: CompletionData = {
      collections: ctx ? collectionNames(ctx.connId, ctx.db) : [],
      fields
    }

    const r = computeShellCompletion(before, context.pos, data)
    return r ? { from: r.from, options: r.options, validFor: r.validFor } : null
  } catch {
    return null
  }
}
