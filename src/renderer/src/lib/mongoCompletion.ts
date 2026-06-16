/**
 * CodeMirror 6 completion source for the mongo shell editor.
 *
 * Decides suggestions from the text immediately before the cursor:
 *  - `db.<word>`           → collection names (active db) + Db methods
 *  - `db.<coll>.<word>`    → collection methods (+ warms the field cache)
 *  - `).<word>`            → cursor methods (sort/limit/toArray/…)
 *  - `<field>: <value>`    → value candidates for the slot we're in
 *                           (sort→1/-1, projection→1/0, boolean keys→true/false)
 *  - `$<word>`             → MongoDB operators, scoped to the call we're inside
 *                           (find→query ops, update→update ops, aggregate→
 *                           pipeline stages + expression ops); union if unsure
 *  - otherwise             → shell globals + JS literals + cached field names
 *
 * Robustness: reads the live store outside React; never throws (returns null).
 */
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { useAppStore, getActiveTab } from '@renderer/store/useAppStore'

// --------------------------------------------------------------------------
// Static vocabularies
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

export const SHELL_GLOBALS = [
  'ObjectId', 'ISODate', 'NumberLong', 'NumberInt', 'NumberDecimal', 'UUID', 'BinData',
  'Timestamp', 'MinKey', 'MaxKey', 'Date', 'RegExp'
]

export const JS_KEYWORDS = ['true', 'false', 'null']

// Query operators (find filters / $match).
const QUERY_OPERATORS = [
  '$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin',
  '$and', '$or', '$nor', '$not',
  '$exists', '$type',
  '$expr', '$jsonSchema', '$mod', '$regex', '$options', '$text', '$search', '$language',
  '$caseSensitive', '$diacriticSensitive', '$where', '$comment', '$rand',
  '$geoWithin', '$geoIntersects', '$near', '$nearSphere', '$geometry', '$center', '$centerSphere',
  '$box', '$polygon', '$maxDistance', '$minDistance',
  '$all', '$elemMatch', '$size',
  '$bitsAllClear', '$bitsAllSet', '$bitsAnyClear', '$bitsAnySet',
  '$slice', '$meta'
]

// Update operators.
const UPDATE_OPERATORS = [
  '$set', '$unset', '$setOnInsert', '$inc', '$mul', '$min', '$max', '$rename', '$currentDate',
  '$push', '$pull', '$pullAll', '$pop', '$addToSet',
  '$each', '$position', '$slice', '$sort', '$bit'
]

// Aggregation pipeline stages.
export const AGG_STAGES = [
  '$addFields', '$bucket', '$bucketAuto', '$changeStream', '$collStats', '$count', '$densify',
  '$documents', '$facet', '$fill', '$geoNear', '$graphLookup', '$group', '$indexStats', '$limit',
  '$lookup', '$match', '$merge', '$out', '$project', '$redact', '$replaceRoot', '$replaceWith',
  '$sample', '$search', '$searchMeta', '$set', '$setWindowFields', '$skip', '$sort', '$sortByCount',
  '$unionWith', '$unset', '$unwind', '$vectorSearch'
]

// Aggregation expression / accumulator operators.
export const AGG_EXPR_OPERATORS = [
  // arithmetic
  '$abs', '$add', '$ceil', '$divide', '$exp', '$floor', '$ln', '$log', '$log10', '$mod',
  '$multiply', '$pow', '$round', '$sqrt', '$subtract', '$trunc',
  // array
  '$arrayElemAt', '$arrayToObject', '$concatArrays', '$filter', '$first', '$firstN', '$in',
  '$indexOfArray', '$isArray', '$last', '$lastN', '$map', '$maxN', '$minN', '$objectToArray',
  '$range', '$reduce', '$reverseArray', '$size', '$slice', '$sortArray', '$zip',
  // boolean / comparison / conditional
  '$and', '$or', '$not', '$cmp', '$eq', '$gt', '$gte', '$lt', '$lte', '$ne',
  '$cond', '$ifNull', '$switch',
  // date
  '$dateAdd', '$dateDiff', '$dateFromParts', '$dateFromString', '$dateSubtract', '$dateToParts',
  '$dateToString', '$dateTrunc', '$dayOfMonth', '$dayOfWeek', '$dayOfYear', '$hour', '$isoDayOfWeek',
  '$isoWeek', '$isoWeekYear', '$millisecond', '$minute', '$month', '$second', '$week', '$year',
  // string
  '$concat', '$indexOfBytes', '$indexOfCP', '$ltrim', '$regexFind', '$regexFindAll', '$regexMatch',
  '$replaceOne', '$replaceAll', '$rtrim', '$split', '$strLenBytes', '$strLenCP', '$strcasecmp',
  '$substr', '$substrBytes', '$substrCP', '$toLower', '$toUpper', '$trim',
  // object / set / type
  '$mergeObjects', '$setDifference', '$setEquals', '$setIntersection', '$setIsSubset', '$setUnion',
  '$allElementsTrue', '$anyElementTrue', '$getField', '$setField', '$literal', '$type', '$isNumber',
  '$convert', '$toBool', '$toDate', '$toDecimal', '$toDouble', '$toInt', '$toLong', '$toObjectId',
  '$toString',
  // accumulators
  '$sum', '$avg', '$push', '$addToSet', '$stdDevPop', '$stdDevSamp', '$count', '$accumulator',
  '$bottom', '$bottomN', '$top', '$topN', '$mergeObjects',
  // window / misc
  '$rank', '$denseRank', '$documentNumber', '$shift', '$derivative', '$integral', '$expMovingAvg',
  '$linearFill', '$locf', '$function', '$let', '$meta', '$rand', '$sampleRate'
]

// --------------------------------------------------------------------------
// Option builders
// --------------------------------------------------------------------------

function opt(label: string, type: Completion['type'], detail: string): Completion {
  return { label, type, detail }
}

type CallContext = 'aggregate' | 'update' | 'query' | null

/** Which collection method's call are we currently (innermost) inside? */
function detectCallContext(before: string): CallContext {
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
  const ctx = detectCallContext(before)
  const map = new Map<string, Completion>()
  const add = (labels: string[], detail: string): void => {
    for (const l of labels) if (!map.has(l)) map.set(l, opt(l, 'property', detail))
  }
  if (ctx === 'aggregate') {
    add(AGG_STAGES, 'agg stage')
    add(AGG_EXPR_OPERATORS, 'expr op')
  } else if (ctx === 'update') {
    add(UPDATE_OPERATORS, 'update op')
    add(AGG_EXPR_OPERATORS, 'expr op (pipeline update)')
  } else if (ctx === 'query') {
    add(QUERY_OPERATORS, 'query op')
  } else {
    add(QUERY_OPERATORS, 'query op')
    add(UPDATE_OPERATORS, 'update op')
    add(AGG_STAGES, 'agg stage')
    add(AGG_EXPR_OPERATORS, 'expr op')
  }
  return [...map.values()]
}

function activeContext(): { connId: string; db: string } | null {
  const s = useAppStore.getState()
  const db = getActiveTab(s).activeDatabase
  if (!s.activeConnectionId || !db) return null
  return { connId: s.activeConnectionId, db }
}

function collectionNames(connId: string, db: string): string[] {
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

// Keys whose value is a boolean (option flags). Used to offer true/false.
const BOOLEAN_KEYS = new Set([
  '$exists', 'upsert', 'multi', 'unique', 'sparse', 'background', 'new',
  'returnNewDocument', 'allowDiskUse', 'bypassDocumentValidation', 'ordered',
  'justOne', 'caseSensitive', 'diacriticSensitive', 'showRecordId', 'returnKey'
])

/** Is the cursor sitting inside an unterminated string literal? (heuristic) */
function inString(before: string): boolean {
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
  if (isInsideSort(before)) return [opt('1', 'text', 'ascending'), opt('-1', 'text', 'descending')]
  if (isInsideProjection(before)) return [opt('1', 'text', 'include'), opt('0', 'text', 'exclude')]
  if (BOOLEAN_KEYS.has(key)) return [opt('true', 'text', 'boolean'), opt('false', 'text', 'boolean')]
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
    for (const name of data.collections) options.push(opt(name, 'class', 'collection'))
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

  // otherwise → globals + literals + cached field names
  const wordMatch = /([\w$]*)$/.exec(before)
  const word = wordMatch ? wordMatch[1] : ''
  const options: Completion[] = []
  for (const g of SHELL_GLOBALS) options.push(opt(g, 'keyword', 'constructor'))
  for (const kw of JS_KEYWORDS) options.push(opt(kw, 'keyword', 'literal'))
  for (const f of data.fields) options.push(opt(f, 'variable', 'field'))
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
