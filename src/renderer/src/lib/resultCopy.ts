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
import { cellValue, deriveColumns } from './tableShape'
import type { CollectionSort } from '@shared/types'
import { useAppStore } from '@renderer/store/useAppStore'
import i18n from '@renderer/i18n'

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
function unwrapExtended(o: Dict, recurse: (value: unknown) => unknown = toPlainValue): unknown {
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
    return '$scope' in o ? { code: String(o['$code']), scope: recurse(o['$scope']) } : String(o['$code'])
  }
  if ('$ref' in o && '$id' in o) {
    const out: Dict = { $ref: String(o['$ref']), $id: recurse(o['$id']) }
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

/** Plain-JSON field fragment for a context-menu "Copy Key-Value" action. */
export function toPlainKeyValue(key: string, value: unknown): string {
  return `${JSON.stringify(key)}: ${JSON.stringify(toPlainValue(value), null, 2) ?? 'null'}`
}

export interface BoundedPreview {
  text: string
  truncated: boolean
}

interface PreviewLimits {
  maxChars?: number
  maxDepth?: number
  maxLines?: number
  maxStringChars?: number
}

const DEFAULT_PREVIEW_LIMITS = {
  maxChars: 1200,
  maxDepth: 4,
  maxLines: 16,
  maxStringChars: 160
} as const

function truncateCodePoints(text: string, maxChars: number): { text: string; truncated: boolean } {
  const chars = Array.from(text)
  if (chars.length <= maxChars) return { text, truncated: false }
  return { text: `${chars.slice(0, Math.max(0, maxChars - 1)).join('')}…`, truncated: true }
}

function uniqueEllipsisKey(target: Dict): string {
  let key = '…'
  while (Object.prototype.hasOwnProperty.call(target, key)) key += '…'
  return key
}

function buildPreviewValue(
  value: unknown,
  depth: number,
  budget: { nodes: number; truncated: boolean },
  maxDepth: number,
  maxStringChars: number
): unknown {
  if (budget.nodes <= 0) {
    budget.truncated = true
    return '…'
  }
  budget.nodes -= 1

  if (typeof value === 'string') {
    const truncated = truncateCodePoints(value, maxStringChars)
    if (truncated.truncated) budget.truncated = true
    return truncated.text
  }
  if (typeof value === 'bigint') return String(value)
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value
  if (value === undefined) return null

  if (Array.isArray(value)) {
    if (depth >= maxDepth) {
      budget.truncated = true
      return ['…']
    }
    const out: unknown[] = []
    for (const item of value) {
      if (budget.nodes <= 0) break
      out.push(buildPreviewValue(item, depth + 1, budget, maxDepth, maxStringChars))
    }
    if (out.length < value.length) {
      budget.truncated = true
      out.push('…')
    }
    return out
  }

  if (isObject(value)) {
    if (isExtended(value)) {
      const unwrapped = unwrapExtended(value, (nested) =>
        buildPreviewValue(nested, depth + 1, budget, maxDepth, maxStringChars)
      )
      return buildPreviewValue(unwrapped, depth, budget, maxDepth, maxStringChars)
    }
    if (depth >= maxDepth) {
      budget.truncated = true
      return { '…': '…' }
    }
    const entries = Object.entries(value)
    const out: Dict = {}
    for (const [rawKey, item] of entries) {
      if (budget.nodes <= 0) break
      const key = truncateCodePoints(rawKey, maxStringChars)
      if (key.truncated) budget.truncated = true
      let displayKey = key.text
      while (Object.prototype.hasOwnProperty.call(out, displayKey)) displayKey += '…'
      out[displayKey] = buildPreviewValue(item, depth + 1, budget, maxDepth, maxStringChars)
    }
    if (Object.keys(out).length < entries.length) {
      budget.truncated = true
      out[uniqueEllipsisKey(out)] = '…'
    }
    return out
  }

  const scalar = truncateCodePoints(String(value), maxStringChars)
  if (scalar.truncated) budget.truncated = true
  return scalar.text
}

/** Pretty JSON preview that never traverses or renders an unbounded value. */
export function formatJsonPreview(value: unknown, limits: PreviewLimits = {}): BoundedPreview {
  const { maxChars, maxDepth, maxLines, maxStringChars } = { ...DEFAULT_PREVIEW_LIMITS, ...limits }

  for (let nodeLimit = 48; nodeLimit >= 1; nodeLimit -= 1) {
    const budget = { nodes: nodeLimit, truncated: false }
    const previewValue = buildPreviewValue(value, 0, budget, maxDepth, maxStringChars)
    const json = JSON.stringify(previewValue, null, 2) ?? String(previewValue)
    const text = budget.truncated ? `${json}\n…` : json
    if (text.length <= maxChars && text.split('\n').length <= maxLines) {
      return { text, truncated: budget.truncated }
    }
  }

  return { text: '…', truncated: true }
}

/** Preserve code/text layout while bounding tooltip work and viewport usage. */
export function formatTextPreview(
  value: string,
  { maxChars = DEFAULT_PREVIEW_LIMITS.maxChars, maxLines = DEFAULT_PREVIEW_LIMITS.maxLines }: PreviewLimits = {}
): BoundedPreview {
  const normalized = value.replace(/\r\n?/g, '\n')
  const truncated = normalized.split('\n').length > maxLines || Array.from(normalized).length > maxChars
  if (!truncated) return { text: normalized, truncated: false }

  const contentLineLimit = Math.max(0, maxLines - 1)
  const contentCharLimit = Math.max(0, maxChars - 2)
  const lines: string[] = []
  let usedChars = 0
  for (const line of normalized.split('\n').slice(0, contentLineLimit)) {
    const separatorChars = lines.length > 0 ? 1 : 0
    const remaining = contentCharLimit - usedChars - separatorChars
    if (remaining <= 0) break
    const clipped = truncateCodePoints(line, remaining)
    lines.push(clipped.text)
    usedChars += separatorChars + Array.from(clipped.text).length
    if (clipped.truncated) break
  }
  return { text: [...lines, '…'].join('\n'), truncated: true }
}

// ----------------------------------------------------------------- CSV / TSV

/** Quote a field (doubling internal quotes) only when it contains the delimiter,
    a quote, or a line break — standard RFC-4180-style escaping. */
function escapeField(text: string, delimiter: string): string {
  if (text.includes(delimiter) || text.includes('"') || text.includes('\n') || text.includes('\r')) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

/** One cell's text: scalars plain, nested objects/arrays as compact JSON. */
function cellText(doc: unknown, column: string): string {
  const { present, value } = cellValue(doc, column)
  if (!present) return ''
  const p = toPlainValue(value)
  if (p === null) return ''
  return typeof p === 'object' ? JSON.stringify(p) : String(p)
}

/** Serialize docs as a delimited table (header row + one row per doc), using the
    same column derivation as the Table view. */
function toDelimited(docs: unknown[], delimiter: string, sort: CollectionSort): string {
  const cols = deriveColumns(docs, sort)
  const header = cols.map((c) => escapeField(c, delimiter)).join(delimiter)
  const rows = docs.map((doc) => cols.map((c) => escapeField(cellText(doc, c), delimiter)).join(delimiter))
  return [header, ...rows].join('\n')
}

/** Comma-separated table with a header row. */
export function toCsv(docs: unknown[], sort: CollectionSort = 'alpha'): string {
  return toDelimited(docs, ',', sort)
}

/** Tab-separated table with a header row (pastes cleanly into Excel/Sheets). */
export function toTsv(docs: unknown[], sort: CollectionSort = 'alpha'): string {
  return toDelimited(docs, '\t', sort)
}

/**
 * Write `text` to the clipboard. Resolves `true` on success, `false` on failure
 * (e.g. clipboard permission denied) — which also surfaces via `lastError`
 * rather than throwing. Callers that don't care about the outcome can ignore it.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    useAppStore.setState({ lastError: i18n.t('notify.clipboardUnavailable') })
    return false
  }
}
