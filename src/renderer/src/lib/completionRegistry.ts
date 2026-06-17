/**
 * Single source of truth for the *data* side of shell completion — the items
 * that aren't TypeScript bindings the language service can see (those live in
 * `tsAutocomplete/mongoBaseDts.ts`). Each group is tagged with a category so
 * consumers map it to the right CodeMirror icon/detail. Extending completion =
 * editing a table here, not touching regex.
 *
 * Categories across the whole feature (see `shellCompletion.ts` for the split):
 *  - collection / method : TS engine (member access — real types)
 *  - snippet             : TS methods rendered as call snippets
 *  - operator            : $-keys inside query/update/aggregate documents (here)
 *  - value               : value-slot candidates — sort 1/-1, projection, boolean (here)
 *  - field               : sampled field names (store)
 *  - global              : EJSON constructors / shell globals (here)
 *  - keyword             : JS keywords + literals (here)
 *  - command             : mongosh REPL commands — show dbs / use … (here)
 */

export type Category =
  | 'collection'
  | 'method'
  | 'snippet'
  | 'operator'
  | 'value'
  | 'field'
  | 'global'
  | 'keyword'
  | 'command'

export type OpContext = 'query' | 'update' | 'aggregate'

// --------------------------------------------------------------------------
// Operators
// --------------------------------------------------------------------------

/** Query operators (find filters / $match). */
export const QUERY_OPERATORS = [
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

/** Update operators. */
export const UPDATE_OPERATORS = [
  '$set', '$unset', '$setOnInsert', '$inc', '$mul', '$min', '$max', '$rename', '$currentDate',
  '$push', '$pull', '$pullAll', '$pop', '$addToSet',
  '$each', '$position', '$slice', '$sort', '$bit'
]

/** Aggregation pipeline stages. */
export const AGG_STAGES = [
  '$addFields', '$bucket', '$bucketAuto', '$changeStream', '$collStats', '$count', '$densify',
  '$documents', '$facet', '$fill', '$geoNear', '$graphLookup', '$group', '$indexStats', '$limit',
  '$lookup', '$match', '$merge', '$out', '$project', '$redact', '$replaceRoot', '$replaceWith',
  '$sample', '$search', '$searchMeta', '$set', '$setWindowFields', '$skip', '$sort', '$sortByCount',
  '$unionWith', '$unset', '$unwind', '$vectorSearch'
]

/** Aggregation expression / accumulator operators. */
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
  // accumulators ($mergeObjects also lives in the object/set/type group above)
  '$sum', '$avg', '$push', '$addToSet', '$stdDevPop', '$stdDevSamp', '$count', '$accumulator',
  '$bottom', '$bottomN', '$top', '$topN',
  // window / misc
  '$rank', '$denseRank', '$documentNumber', '$shift', '$derivative', '$integral', '$expMovingAvg',
  '$linearFill', '$locf', '$function', '$let', '$meta', '$rand', '$sampleRate'
]

export interface OperatorGroup {
  labels: string[]
  detail: string
}

/**
 * Operator groups applicable to the enclosing call context (null = unknown →
 * the union of all). Order matters: earlier groups win the `detail` on dedup.
 */
export function operatorGroups(ctx: OpContext | null): OperatorGroup[] {
  switch (ctx) {
    case 'aggregate':
      return [
        { labels: AGG_STAGES, detail: 'agg stage' },
        { labels: AGG_EXPR_OPERATORS, detail: 'expr op' }
      ]
    case 'update':
      return [
        { labels: UPDATE_OPERATORS, detail: 'update op' },
        { labels: AGG_EXPR_OPERATORS, detail: 'expr op (pipeline update)' }
      ]
    case 'query':
      return [{ labels: QUERY_OPERATORS, detail: 'query op' }]
    default:
      return [
        { labels: QUERY_OPERATORS, detail: 'query op' },
        { labels: UPDATE_OPERATORS, detail: 'update op' },
        { labels: AGG_STAGES, detail: 'agg stage' },
        { labels: AGG_EXPR_OPERATORS, detail: 'expr op' }
      ]
  }
}

// --------------------------------------------------------------------------
// Globals / keywords / literals
// --------------------------------------------------------------------------

/** EJSON constructors / shell globals (also declared in the base d.ts). */
export const SHELL_GLOBALS = [
  'ObjectId', 'ISODate', 'NumberLong', 'NumberInt', 'NumberDecimal', 'UUID', 'BinData',
  'Timestamp', 'MinKey', 'MaxKey', 'Date', 'RegExp'
]

/** JS literals (kept separate from keywords so detail reads "literal"). */
export const JS_LITERALS = ['true', 'false', 'null', 'undefined']

/** JS keywords offered at a bare-word position. */
export const JS_KEYWORDS = [
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do',
  'switch', 'case', 'break', 'continue', 'new', 'typeof', 'instanceof', 'delete',
  'void', 'in', 'of', 'try', 'catch', 'finally', 'throw', 'debugger', 'await', 'async',
  'this', 'class', 'extends', 'yield'
]

// --------------------------------------------------------------------------
// Value slots
// --------------------------------------------------------------------------

export interface ValueChoice {
  label: string
  detail: string
}

export const SORT_VALUES: ValueChoice[] = [
  { label: '1', detail: 'ascending' },
  { label: '-1', detail: 'descending' }
]
export const PROJECTION_VALUES: ValueChoice[] = [
  { label: '1', detail: 'include' },
  { label: '0', detail: 'exclude' }
]
export const BOOLEAN_VALUES: ValueChoice[] = [
  { label: 'true', detail: 'boolean' },
  { label: 'false', detail: 'boolean' }
]

/** Keys whose value is a boolean (option flags) → offer true/false. */
export const BOOLEAN_KEYS = new Set([
  '$exists', 'upsert', 'multi', 'unique', 'sparse', 'background', 'new',
  'returnNewDocument', 'allowDiskUse', 'bypassDocumentValidation', 'ordered',
  'justOne', 'caseSensitive', 'diacriticSensitive', 'showRecordId', 'returnKey'
])

// --------------------------------------------------------------------------
// REPL commands (mongosh-style; require shellCore REPL support to run)
// --------------------------------------------------------------------------

export interface CommandDef {
  /** What shows in the dropdown. */
  label: string
  detail: string
  /** Text inserted on accept (defaults to `label`). */
  apply?: string
}

export const SHELL_COMMANDS: CommandDef[] = [
  { label: 'show dbs', detail: 'list databases' },
  { label: 'show databases', detail: 'list databases' },
  { label: 'show collections', detail: 'list collections' },
  { label: 'show tables', detail: 'list collections' },
  { label: 'show users', detail: 'list users' },
  { label: 'show roles', detail: 'list roles' },
  { label: 'show profile', detail: 'system.profile entries' },
  { label: 'use', detail: 'switch database', apply: 'use ' }
]
