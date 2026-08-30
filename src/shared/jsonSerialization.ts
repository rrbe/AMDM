import { EJSON } from 'bson'
import type { JsonEncoding } from './types'

type Dict = Record<string, unknown>

function isObject(value: unknown): value is Dict {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasKey(value: Dict, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

/** Whether a structured-cloneable value is one canonical EJSON type wrapper. */
export function isEjsonWrapper(value: unknown): value is Dict {
  if (!isObject(value)) return false
  const keys = Object.keys(value)
  if (keys.length === 0) return false
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
      case '$code':
        return true
      default:
        return false
    }
  }
  return hasKey(value, '$code') || (hasKey(value, '$ref') && hasKey(value, '$id')) || hasKey(value, '$binary')
}

function dateToIso(payload: unknown): string {
  if (typeof payload === 'string') return payload
  if (isObject(payload) && '$numberLong' in payload) {
    const milliseconds = Number(payload['$numberLong'])
    if (!Number.isNaN(milliseconds)) return new Date(milliseconds).toISOString()
  }
  if (typeof payload === 'number') return new Date(payload).toISOString()
  return String(payload)
}

/** Collapse one canonical EJSON wrapper to its closest ordinary JSON value. */
export function unwrapEjsonWrapper(value: Dict, recurse: (nested: unknown) => unknown = toPlainJsonValue): unknown {
  if ('$oid' in value) return String(value['$oid'])
  if ('$date' in value) return dateToIso(value['$date'])
  if ('$numberInt' in value) return Number(value['$numberInt'])
  if ('$numberLong' in value) {
    const text = String(value['$numberLong'])
    const number = Number(text)
    return Number.isSafeInteger(number) ? number : text
  }
  if ('$numberDouble' in value) {
    const number = Number(value['$numberDouble'])
    return Number.isFinite(number) ? number : String(value['$numberDouble'])
  }
  if ('$numberDecimal' in value) return String(value['$numberDecimal'])
  if ('$binary' in value) {
    const binary = value['$binary']
    return isObject(binary) ? String(binary['base64'] ?? '') : String(binary)
  }
  if ('$regularExpression' in value) {
    const expression = value['$regularExpression']
    return isObject(expression)
      ? `/${String(expression['pattern'] ?? '')}/${String(expression['options'] ?? '')}`
      : '/regex/'
  }
  if ('$timestamp' in value) {
    const timestamp = value['$timestamp']
    return isObject(timestamp) ? { t: Number(timestamp['t'] ?? 0), i: Number(timestamp['i'] ?? 0) } : String(timestamp)
  }
  if ('$minKey' in value) return 'MinKey'
  if ('$maxKey' in value) return 'MaxKey'
  if ('$undefined' in value) return null
  if ('$symbol' in value) return String(value['$symbol'])
  if ('$code' in value) {
    return '$scope' in value
      ? { code: String(value['$code']), scope: recurse(value['$scope']) }
      : String(value['$code'])
  }
  if ('$ref' in value && '$id' in value) {
    const output: Dict = { $ref: String(value['$ref']), $id: recurse(value['$id']) }
    if (value['$db'] !== undefined) output['$db'] = String(value['$db'])
    return output
  }
  return value
}

/** Recursively convert canonical EJSON into ordinary JSON-compatible values. */
export function toPlainJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toPlainJsonValue)
  if (isObject(value)) {
    if (isEjsonWrapper(value)) return unwrapEjsonWrapper(value)
    const output: Dict = {}
    for (const [key, nested] of Object.entries(value)) output[key] = toPlainJsonValue(nested)
    return output
  }
  return value
}

/** Convert a canonical EJSON wire value to the selected JSON representation. */
export function encodeCanonicalJson(value: unknown, encoding: JsonEncoding): unknown {
  if (encoding === 'plain') return toPlainJsonValue(value)
  if (encoding === 'canonical') return value
  const bsonValue = EJSON.parse(JSON.stringify(value), { relaxed: false })
  return EJSON.serialize(bsonValue, { relaxed: true })
}
