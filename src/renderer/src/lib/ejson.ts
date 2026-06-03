/**
 * EJSON display helpers.
 *
 * The backend serializes BSON results to **EJSON-canonical** plain objects:
 * extended types are wrapped, e.g.
 *   { "$oid": "..." }
 *   { "$date": "2024-..." } | { "$date": { "$numberLong": "..." } }
 *   { "$numberLong": "..." } | { "$numberInt": "..." } | { "$numberDouble": "..." }
 *   { "$numberDecimal": "..." }
 *   { "$binary": { base64, subType } }
 *   { "$regularExpression": { pattern, options } }
 *   { "$timestamp": { t, i } }
 *   { "$minKey": 1 } | { "$maxKey": 1 } | { "$undefined": true }
 *   { "$code": "...", "$scope"?: {...} }
 *   { "$ref": "...", "$id": ..., "$db"?: "..." }  (DBRef)
 *   { "$symbol": "..." }
 *
 * These helpers let the Tree/Table/JSON views render those types with the right
 * label, color tag, and (crucially) decide which nodes are expandable.
 *
 * NOTE on `unknown`: EJSON values arrive as `unknown` over IPC; we narrow with
 * runtime checks rather than trusting a shared type, since the shape is dynamic.
 */

export type ValueType =
  | 'objectId'
  | 'date'
  | 'number'
  | 'long'
  | 'int'
  | 'double'
  | 'decimal'
  | 'string'
  | 'boolean'
  | 'null'
  | 'undefined'
  | 'array'
  | 'object'
  | 'binary'
  | 'regex'
  | 'timestamp'
  | 'minKey'
  | 'maxKey'
  | 'code'
  | 'dbref'
  | 'symbol'

export interface ScalarDisplay {
  /** Human display string, e.g. `ObjectId("...")`, `ISODate("...")`, `42`. */
  text: string
  /** Semantic type tag for color-coding. */
  type: ValueType
}

type Dict = Record<string, unknown>

function isPlainObject(value: unknown): value is Dict {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasKey(obj: Dict, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key)
}

/**
 * Detect an EJSON extended-type wrapper object. These are treated as *leaf
 * scalars* by the tree views (you don't expand into `$oid`'s string), even
 * though they are technically objects.
 */
export function isExtended(value: unknown): boolean {
  if (!isPlainObject(value)) return false
  const keys = Object.keys(value)
  if (keys.length === 0) return false

  // Single-marker wrappers.
  if (keys.length === 1) {
    switch (keys[0]) {
      case '$oid':
      case '$date':
      case '$numberLong':
      case '$numberInt':
      case '$numberDouble':
      case '$numberDecimal':
      case '$binary':
      case '$regularExpression':
      case '$timestamp':
      case '$minKey':
      case '$maxKey':
      case '$undefined':
      case '$symbol':
        return true
      default:
        return false
    }
  }

  // Multi-key wrappers.
  if (hasKey(value, '$code')) return true // { $code, $scope? }
  if (hasKey(value, '$ref') && hasKey(value, '$id')) return true // DBRef
  // Legacy/shell binary form: { $binary, $type }
  if (hasKey(value, '$binary')) return true

  return false
}

/** Coerce an EJSON number wrapper's inner value to a string for display. */
function numberInner(v: unknown): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number') return String(v)
  return String(v)
}

/** Render a `$date` payload (string or { $numberLong }) as an ISO string. */
function formatDate(payload: unknown): string {
  if (typeof payload === 'string') return payload
  if (isPlainObject(payload) && hasKey(payload, '$numberLong')) {
    const ms = Number(payload['$numberLong'])
    if (!Number.isNaN(ms)) return new Date(ms).toISOString()
  }
  if (typeof payload === 'number') return new Date(payload).toISOString()
  return String(payload)
}

/**
 * Produce a display string + semantic type for any EJSON scalar OR plain JSON
 * primitive. Callers should only pass values that are NOT expandable (i.e.
 * `isExtended(value)` or a JSON primitive). For arrays/plain objects this
 * returns a summary placeholder.
 */
export function formatScalar(value: unknown): ScalarDisplay {
  // Plain JSON primitives.
  if (value === null) return { text: 'null', type: 'null' }
  if (value === undefined) return { text: 'undefined', type: 'undefined' }
  if (typeof value === 'string') return { text: value, type: 'string' }
  if (typeof value === 'boolean') return { text: String(value), type: 'boolean' }
  if (typeof value === 'number') return { text: String(value), type: 'number' }
  if (typeof value === 'bigint') return { text: String(value), type: 'long' }

  if (Array.isArray(value)) {
    return { text: `Array(${value.length})`, type: 'array' }
  }

  if (isPlainObject(value)) {
    // ---- Extended types ----
    if (hasKey(value, '$oid')) {
      return { text: `ObjectId("${String(value['$oid'])}")`, type: 'objectId' }
    }
    if (hasKey(value, '$date')) {
      return { text: `ISODate("${formatDate(value['$date'])}")`, type: 'date' }
    }
    if (hasKey(value, '$numberLong') && Object.keys(value).length === 1) {
      return { text: `NumberLong("${numberInner(value['$numberLong'])}")`, type: 'long' }
    }
    if (hasKey(value, '$numberInt') && Object.keys(value).length === 1) {
      return { text: numberInner(value['$numberInt']), type: 'int' }
    }
    if (hasKey(value, '$numberDouble') && Object.keys(value).length === 1) {
      return { text: numberInner(value['$numberDouble']), type: 'double' }
    }
    if (hasKey(value, '$numberDecimal') && Object.keys(value).length === 1) {
      return {
        text: `NumberDecimal("${numberInner(value['$numberDecimal'])}")`,
        type: 'decimal'
      }
    }
    if (hasKey(value, '$binary')) {
      const bin = value['$binary']
      const subType = isPlainObject(bin) ? String(bin['subType'] ?? '') : String(value['$type'] ?? '')
      return { text: `BinData(${subType || '0'}, …)`, type: 'binary' }
    }
    if (hasKey(value, '$regularExpression')) {
      const re = value['$regularExpression']
      if (isPlainObject(re)) {
        return {
          text: `/${String(re['pattern'] ?? '')}/${String(re['options'] ?? '')}`,
          type: 'regex'
        }
      }
      return { text: '/regex/', type: 'regex' }
    }
    if (hasKey(value, '$timestamp')) {
      const ts = value['$timestamp']
      if (isPlainObject(ts)) {
        return { text: `Timestamp(${String(ts['t'] ?? 0)}, ${String(ts['i'] ?? 0)})`, type: 'timestamp' }
      }
      return { text: 'Timestamp(…)', type: 'timestamp' }
    }
    if (hasKey(value, '$minKey')) return { text: 'MinKey', type: 'minKey' }
    if (hasKey(value, '$maxKey')) return { text: 'MaxKey', type: 'maxKey' }
    if (hasKey(value, '$undefined')) return { text: 'undefined', type: 'undefined' }
    if (hasKey(value, '$symbol')) return { text: `Symbol("${String(value['$symbol'])}")`, type: 'symbol' }
    if (hasKey(value, '$code')) {
      return { text: `Code(${String(value['$code'])})`, type: 'code' }
    }
    if (hasKey(value, '$ref') && hasKey(value, '$id')) {
      const id = formatScalar(value['$id']).text
      return { text: `DBRef("${String(value['$ref'])}", ${id})`, type: 'dbref' }
    }

    // Plain object summary.
    const n = Object.keys(value).length
    return { text: `Object {${n}}`, type: 'object' }
  }

  return { text: String(value), type: 'string' }
}

/**
 * Return the semantic type of a value (without building a display string).
 * Used for color-coding and for deciding expandability.
 */
export function valueType(value: unknown): ValueType {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (Array.isArray(value)) return 'array'
  const t = typeof value
  if (t === 'string') return 'string'
  if (t === 'boolean') return 'boolean'
  if (t === 'number') return 'number'
  if (t === 'bigint') return 'long'
  if (isPlainObject(value)) {
    if (isExtended(value)) return formatScalar(value).type
    return 'object'
  }
  return 'string'
}

/** BSON type display labels (the names Compass/the shell use). */
const TYPE_LABELS: Record<ValueType, string> = {
  objectId: 'ObjectId',
  date: 'Date',
  number: 'Double',
  long: 'Int64',
  int: 'Int32',
  double: 'Double',
  decimal: 'Decimal128',
  string: 'String',
  boolean: 'Boolean',
  null: 'Null',
  undefined: 'Undefined',
  array: 'Array',
  object: 'Object',
  binary: 'Binary',
  regex: 'Regex',
  timestamp: 'Timestamp',
  minKey: 'MinKey',
  maxKey: 'MaxKey',
  code: 'Code',
  dbref: 'DBRef',
  symbol: 'Symbol'
}

/** Human BSON-type label for a value (e.g. "ObjectId", "Int32", "Array"). */
export function typeLabel(value: unknown): string {
  return TYPE_LABELS[valueType(value)]
}

/** A value is expandable in the tree iff it's a plain array or plain object. */
export function isExpandable(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0
  if (isPlainObject(value)) return !isExtended(value) && Object.keys(value).length > 0
  return false
}

/**
 * Child [key, value] pairs for tree expansion. Plain objects yield their
 * entries; arrays yield index→value. EJSON wrappers (and primitives) are leaves
 * and yield nothing.
 */
export function entriesOf(value: unknown): Array<[string, unknown]> {
  if (Array.isArray(value)) {
    return value.map((v, i) => [String(i), v] as [string, unknown])
  }
  if (isPlainObject(value) && !isExtended(value)) {
    return Object.entries(value)
  }
  return []
}

/**
 * Short one-line summary for a collapsed expandable node (used in tree rows),
 * e.g. `{ 5 fields }` or `[ 12 ]`.
 */
export function summarize(value: unknown): string {
  if (Array.isArray(value)) return `[ ${value.length} ]`
  if (isPlainObject(value) && !isExtended(value)) {
    return `{ ${Object.keys(value).length} fields }`
  }
  return formatScalar(value).text
}
