/**
 * Inline cell editing — turning a leaf EJSON value into editable text and
 * coercing the edited text back to the SAME EJSON type, so a `$set` preserves
 * the field's BSON type (a number stays a number, an ObjectId stays an ObjectId).
 *
 * Only leaf scalars are inline-editable; containers and exotic types
 * (binary/regex/timestamp/…) return `null` from `editableText` and are edited
 * via the full-document modal instead.
 */
import { valueType, type ValueType } from './ejson'

type Dict = Record<string, unknown>

const EDITABLE: ReadonlySet<ValueType> = new Set<ValueType>([
  'string',
  'number',
  'int',
  'long',
  'double',
  'decimal',
  'boolean',
  'null',
  'objectId',
  'date'
])

/** Whether a value can be edited inline. */
export function isEditableValue(value: unknown): boolean {
  return EDITABLE.has(valueType(value))
}

function dateIso(payload: unknown): string {
  if (typeof payload === 'string') return payload
  if (payload !== null && typeof payload === 'object' && '$numberLong' in payload) {
    const ms = Number((payload as Dict)['$numberLong'])
    if (!Number.isNaN(ms)) return new Date(ms).toISOString()
  }
  if (typeof payload === 'number') return new Date(payload).toISOString()
  return String(payload)
}

/** Pre-filled editor text for a value, or `null` when it isn't inline-editable. */
export function editableText(value: unknown): string | null {
  const t = valueType(value)
  if (!EDITABLE.has(t)) return null
  const o = value as Dict
  switch (t) {
    case 'string':
      return value as string
    case 'boolean':
    case 'number':
      return String(value)
    case 'null':
      return 'null'
    case 'objectId':
      return String(o['$oid'])
    case 'date':
      return dateIso(o['$date'])
    case 'int':
      return String(o['$numberInt'])
    case 'long':
      return String(o['$numberLong'])
    case 'double':
      return String(o['$numberDouble'])
    case 'decimal':
      return String(o['$numberDecimal'])
    default:
      return null
  }
}

type CoerceResult = { value: unknown } | { error: string }

/**
 * Coerce edited `text` back to the same EJSON type as `original`, returning the
 * new EJSON-canonical value (to be JSON.stringified into `valueEjson`), or an
 * error message for invalid input.
 */
export function coerceEdit(original: unknown, text: string): CoerceResult {
  const t = valueType(original)
  const trimmed = text.trim()
  switch (t) {
    case 'string':
      return { value: text } // keep raw (spaces may be meaningful)
    case 'boolean':
      if (trimmed === 'true') return { value: true }
      if (trimmed === 'false') return { value: false }
      return { error: '请输入 true 或 false' }
    case 'null':
      // Keep simple: literal "null" → null; anything else becomes a string.
      return { value: trimmed === 'null' ? null : text }
    case 'number': {
      const n = Number(trimmed)
      return Number.isFinite(n) ? { value: n } : { error: '不是合法数字' }
    }
    case 'double': {
      const n = Number(trimmed)
      return Number.isFinite(n) ? { value: { $numberDouble: String(n) } } : { error: '不是合法数字' }
    }
    case 'int': {
      const n = Number(trimmed)
      return Number.isInteger(n) ? { value: { $numberInt: String(n) } } : { error: '不是合法整数' }
    }
    case 'long':
      return /^-?\d+$/.test(trimmed) ? { value: { $numberLong: trimmed } } : { error: '不是合法整数' }
    case 'decimal':
      return /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(trimmed)
        ? { value: { $numberDecimal: trimmed } }
        : { error: '不是合法小数' }
    case 'objectId':
      return /^[0-9a-fA-F]{24}$/.test(trimmed)
        ? { value: { $oid: trimmed } }
        : { error: 'ObjectId 必须是 24 位十六进制' }
    case 'date': {
      const d = new Date(trimmed)
      return Number.isNaN(d.getTime()) ? { error: '不是合法日期' } : { value: { $date: d.toISOString() } }
    }
    default:
      return { error: '该类型不支持行内编辑' }
  }
}
