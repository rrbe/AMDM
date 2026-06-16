/**
 * The shell editor's completion source. Splits work between two engines:
 *  - **member access** (`db.`, `db.coll.`, `cursor.`, any `expr.`) → the TS
 *    language-service worker, which resolves real chain types (so
 *    `db.coll.find().sort().` knows it's still a cursor, `getSiblingDB(x).`
 *    yields a Database, a `const c = db.x.find(); c.` knows `c` is a Cursor).
 *  - **everything else** (`$operators`, value slots, field names, globals) →
 *    the existing regex `mongoCompletionSource`.
 *
 * The regex source is also the transparent fallback: if the worker is
 * unavailable, fails, times out, or returns nothing, we delegate to it — so
 * completion always works, just less type-aware. Async per CodeMirror's
 * `CompletionSource` Promise contract; honors abort to drop stale requests.
 */
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { snippetCompletion } from '@codemirror/autocomplete'
import {
  mongoCompletionSource,
  activeContext,
  collectionNames,
  inString,
  lengthBoost
} from '@renderer/lib/mongoCompletion'
import { tsAutocomplete } from '@renderer/lib/tsAutocomplete/tsAutocompleteClient'
import type { TsCompletionEntry } from '@renderer/lib/tsAutocomplete/protocol'

/** Cursor is completing a property after a `.` on an expression (not in a string). */
export function isMemberCompletion(before: string): boolean {
  if (inString(before)) return false
  return /[)\]\w$]\s*\.\s*[\w$]*$/.test(before)
}

/** Map a TS `ScriptElementKind` to a CodeMirror completion type (drives the icon). */
function kindToType(kind: string): Completion['type'] {
  switch (kind) {
    case 'method':
    case 'function':
    case 'local function':
      return 'method'
    case 'property':
    case 'getter':
    case 'setter':
      return 'property'
    case 'var':
    case 'let':
    case 'const':
    case 'parameter':
    case 'local var':
    case 'alias':
      return 'variable'
    case 'class':
    case 'interface':
    case 'type':
      return 'class'
    case 'keyword':
      return 'keyword'
    default:
      return 'property'
  }
}

// Method call snippets (CodeMirror snippet syntax — `${}` is a tab stop, `${x}`
// a labelled placeholder). Curated for the common ones; others fall to a default.
const METHOD_SNIPPETS: Record<string, string> = {
  find: 'find({ ${} })',
  findOne: 'findOne({ ${} })',
  aggregate: 'aggregate([ ${} ])',
  limit: 'limit(${10})',
  skip: 'skip(${0})',
  sort: 'sort({ ${field}: ${-1} })',
  project: 'project({ ${field}: ${1} })',
  projection: 'projection({ ${field}: ${1} })',
  countDocuments: 'countDocuments({ ${} })',
  distinct: 'distinct(${field})',
  insertOne: 'insertOne({ ${} })',
  insertMany: 'insertMany([ ${} ])',
  updateOne: 'updateOne({ ${filter} }, { $set: { ${} } })',
  updateMany: 'updateMany({ ${filter} }, { $set: { ${} } })',
  replaceOne: 'replaceOne({ ${filter} }, { ${} })',
  deleteOne: 'deleteOne({ ${} })',
  deleteMany: 'deleteMany({ ${} })',
  createIndex: 'createIndex({ ${field}: ${1} })',
  getSiblingDB: 'getSiblingDB(${db})',
  getCollection: 'getCollection(${name})',
  runCommand: 'runCommand({ ${} })'
}
const ZERO_ARG_METHODS = new Set([
  'toArray', 'itcount', 'count', 'size', 'pretty', 'hasNext', 'next', 'explain',
  'getName', 'getCollectionNames', 'getCollectionInfos', 'drop', 'dropIndexes',
  'getIndexes', 'indexes', 'listIndexes', 'stats', 'admin', 'estimatedDocumentCount'
])

function methodSnippet(name: string): string {
  if (METHOD_SNIPPETS[name]) return METHOD_SNIPPETS[name]
  if (ZERO_ARG_METHODS.has(name)) return `${name}()`
  return `${name}(\${})` // place the cursor inside the parens
}

function isMethodKind(kind: string): boolean {
  return kind === 'method' || kind === 'function' || kind === 'local function'
}

function mapEntry(e: TsCompletionEntry, onDb: boolean): Completion {
  // Reuse the length-boost ranking so shorter, closer matches win prefix ties.
  const boost = lengthBoost(e.name)
  // `db.` members: our generated collections come back as `property` (typed as
  // Collection) — show them with the collection icon (○) + label, not the bare
  // property square (□).
  if (onDb && e.kind === 'property') return { label: e.name, type: 'class', detail: 'collection', boost }
  // Methods insert as call snippets (limit → limit(10), find → find({ })…).
  if (isMethodKind(e.kind)) {
    return snippetCompletion(methodSnippet(e.name), {
      label: e.name,
      type: 'method',
      detail: onDb ? 'db' : undefined,
      boost
    })
  }
  return { label: e.name, type: kindToType(e.kind), boost }
}

export async function shellCompletionSource(
  context: CompletionContext
): Promise<CompletionResult | null> {
  const token = context.matchBefore(/[\w$.]*/)
  if ((!token || token.from === token.to) && !context.explicit) return null

  const before = context.state.sliceDoc(0, context.pos)

  if (isMemberCompletion(before) && tsAutocomplete.isAvailable()) {
    const ctx = activeContext()
    if (ctx) tsAutocomplete.updateCollections(ctx.connId, ctx.db, collectionNames(ctx.connId, ctx.db))

    context.addEventListener?.('abort', () => tsAutocomplete.cancel(), { onDocChange: true })
    const res = await tsAutocomplete.complete(context.state.doc.toString(), context.pos)
    if (context.aborted) return null

    if (res && res.entries.length) {
      const word = /[\w$]*$/.exec(before)?.[0] ?? ''
      const from = res.replacementSpan ? res.replacementSpan.from : context.pos - word.length
      const onDb = /\bdb\s*\.\s*[\w$]*$/.test(before)
      return { from, options: res.entries.map((e) => mapEntry(e, onDb)), validFor: /^[\w$]*$/ }
    }
    // Worker returned nothing usable — fall through to the regex source.
  }

  return mongoCompletionSource(context)
}
