/**
 * Clipboard serialization for result views.
 *
 * Backend results are EJSON-canonical plain objects ({ "$oid": .. } etc.).
 * Three output formats are offered when copying:
 *
 *  - PLAIN JSON (default) — extended types collapsed to the closest *ordinary*
 *    JSON value: ObjectId → hex string, Date → ISO string, NumberLong/Int/Double
 *    → JSON number (out-of-safe-range Long & Decimal kept as strings to preserve
 *    precision), Binary → base64 string, undefined → null. The most paste-
 *    friendly form for general use / sharing.
 *  - SHELL — `ObjectId("..")` / `ISODate("..")`, identical to the JSON view
 *    (reuses the format.ts line builder).
 *  - STRICT EJSON — the canonical wrapper as-is, round-trippable by the driver.
 */
import { isExtended } from './ejson'
import { toJsonLines, indentFor } from './format'
import { useAppStore } from '@renderer/store/useAppStore'

type Dict = Record<string, unknown>

function isObject(v: unknown): v is Dict {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Render a `$date` payload (string | { $numberLong } | number) as ISO. */
function dateToIso(payload: unknown): string {
  if (typeof payload === 'string') return payload
  if (isObject(payload) && '$numberLong' in payload) {
    const ms = Number(payload['$numberLong'])
    if (!Number.isNaN(ms)) return new Date(ms).toISOString()
  }
  if (typeof payload === 'number') return new Date(payload).toISOString()
  return String(payload)
}

/** Collapse an EJSON extended-type wrapper to a plain JSON value. */
function unwrapExtended(o: Dict): unknown {
  if ('$oid' in o) return String(o['$oid'])
  if ('$date' in o) return dateToIso(o['$date'])
  if ('$numberInt' in o) return Number(o['$numberInt'])
  if ('$numberLong' in o) {
    const s = String(o['$numberLong'])
    const n = Number(s)
    // Keep precision: only emit a JS number when it round-trips losslessly.
    return Number.isSafeInteger(n) ? n : s
  }
  if ('$numberDouble' in o) {
    const n = Number(o['$numberDouble'])
    // Infinity / NaN can't be JSON numbers — keep the canonical token string.
    return Number.isFinite(n) ? n : String(o['$numberDouble'])
  }
  if ('$numberDecimal' in o) return String(o['$numberDecimal']) // precision
  if ('$binary' in o) {
    const bin = o['$binary']
    return isObject(bin) ? String(bin['base64'] ?? '') : String(bin) // legacy: string
  }
  if ('$regularExpression' in o) {
    const re = o['$regularExpression']
    if (isObject(re)) return `/${String(re['pattern'] ?? '')}/${String(re['options'] ?? '')}`
    return '/regex/'
  }
  if ('$timestamp' in o) {
    const ts = o['$timestamp']
    if (isObject(ts)) return { t: Number(ts['t'] ?? 0), i: Number(ts['i'] ?? 0) }
    return String(ts)
  }
  if ('$minKey' in o) return 'MinKey'
  if ('$maxKey' in o) return 'MaxKey'
  if ('$undefined' in o) return null
  if ('$symbol' in o) return String(o['$symbol'])
  if ('$code' in o) {
    return '$scope' in o
      ? { code: String(o['$code']), scope: toPlainValue(o['$scope']) }
      : String(o['$code'])
  }
  if ('$ref' in o && '$id' in o) {
    const out: Dict = { $ref: String(o['$ref']), $id: toPlainValue(o['$id']) }
    if (o['$db'] !== undefined) out['$db'] = String(o['$db'])
    return out
  }
  return o // unreachable for known wrappers; pass through defensively
}

/** Recursively collapse an EJSON-canonical value to plain JSON-friendly data. */
export function toPlainValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(toPlainValue)
  if (isObject(v)) {
    if (isExtended(v)) return unwrapExtended(v)
    const out: Dict = {}
    for (const [k, val] of Object.entries(v)) out[k] = toPlainValue(val)
    return out
  }
  return v
}

/** Default copy format — extended types collapsed to ordinary JSON. */
export function toPlainJson(value: unknown): string {
  return JSON.stringify(toPlainValue(value), null, 2)
}

/** Shell-style text, byte-for-byte what the JSON view renders. */
export function toShellText(value: unknown): string {
  return toJsonLines(value)
    .map((l) => indentFor(l.depth) + l.text)
    .join('\n')
}

/** Strict canonical EJSON (the wire form as-is). */
export function toStrictEjson(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

/**
 * Plain-text for a single value (a tree value cell / a table cell). Scalars
 * render bare (a string copies without quotes; an ObjectId copies its hex);
 * objects/arrays fall back to pretty plain JSON.
 */
export function plainScalarText(value: unknown): string {
  const p = toPlainValue(value)
  if (p === null) return 'null'
  if (typeof p === 'string') return p
  if (typeof p === 'number' || typeof p === 'boolean') return String(p)
  return JSON.stringify(p, null, 2)
}

/**
 * Write `text` to the clipboard, silently on success. Only failures (e.g.
 * clipboard permission denied) surface — via `lastError` — rather than throwing.
 */
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    useAppStore.setState({ lastError: '复制失败：剪贴板不可用' })
  }
}
