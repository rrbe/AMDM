/**
 * Pretty-print EJSON values into an array of indented text lines for the
 * (virtualized) JSON view. We render extended types in shell style
 * (`ObjectId("..")`, `ISODate("..")`, `NumberLong("..")`) rather than raw
 * `{ $oid: ".." }`, matching what developers expect from the mongo shell.
 *
 * Output is line-based so the JSON view can virtualize by line and stay smooth
 * for very large results (we never build one giant string and hand it to the
 * DOM).
 */
import { entriesOf, formatScalar, isExtended } from './ejson'

/** A colored segment of a JSON line (key, scalar value, or punctuation). */
export interface JsonToken {
  text: string
  /** CSS class: 'json-key' | 'json-punct' | `v-${ValueType}` for scalars. */
  cls: string
}

export interface JsonLine {
  /** Indentation depth (number of 2-space units). */
  depth: number
  /** Rendered line text (indent-free; the plain fallback for export/edit/explain). */
  text: string
  /** Same content split into colored segments, for the syntax-highlighted view. */
  tokens: JsonToken[]
}

const INDENT = '  '

function quoteKey(key: string): string {
  // Always quote keys in JSON-ish output for predictability.
  return JSON.stringify(key)
}

function punct(text: string): JsonToken {
  return { text, cls: 'json-punct' }
}

/** Render a primitive/extended scalar as its JSON-line representation. */
function scalarText(value: unknown): string {
  const { type, text } = formatScalar(value)
  switch (type) {
    case 'string':
      return JSON.stringify(text)
    case 'number':
    case 'int':
    case 'double':
    case 'boolean':
    case 'null':
    case 'undefined':
      return text
    default:
      // ObjectId("..")/ISODate("..")/NumberLong("..") etc. render verbatim.
      return text
  }
}

const INLINE_PREVIEW_ITEMS = 5
const INLINE_PREVIEW_TEXT_LENGTH = 80

function inlineText(text: string): string {
  return text.length > INLINE_PREVIEW_TEXT_LENGTH ? `${text.slice(0, INLINE_PREVIEW_TEXT_LENGTH)}…` : text
}

function inlineValue(value: unknown): JsonToken {
  if (Array.isArray(value)) return { text: value.length ? `[ ${value.length} ]` : '[]', cls: 'v-array' }
  if (typeof value === 'object' && value !== null && !isExtended(value)) {
    return { text: Object.keys(value).length ? '{ … }' : '{}', cls: 'v-object' }
  }
  const { type } = formatScalar(value)
  const text = typeof value === 'string' ? JSON.stringify(inlineText(value)) : inlineText(scalarText(value))
  return { text, cls: `v-${type}` }
}

/** One level of an object/array, with bounded entries and text for Table cells. */
export function toInlineJsonTokens(value: unknown): JsonToken[] {
  const isArray = Array.isArray(value)
  if (!isArray && (typeof value !== 'object' || value === null || isExtended(value))) {
    return [inlineValue(value)]
  }

  const tokens: JsonToken[] = [punct(isArray ? '[' : '{')]
  let count = 0
  const addValue = (item: unknown, key?: string): void => {
    tokens.push(punct(count++ ? ', ' : ' '))
    if (key !== undefined) {
      const text = inlineText(key)
      tokens.push({ text: /^[A-Za-z_$][\w$]*$/.test(text) ? text : quoteKey(text), cls: 'json-key' }, punct(': '))
    }
    tokens.push(inlineValue(item))
  }

  if (isArray) {
    for (let index = 0; index < Math.min(value.length, INLINE_PREVIEW_ITEMS); index++) addValue(value[index])
    if (value.length > INLINE_PREVIEW_ITEMS) tokens.push(punct(', …'))
  } else {
    for (const key in value) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue
      if (count === INLINE_PREVIEW_ITEMS) {
        tokens.push(punct(', …'))
        break
      }
      addValue((value as Record<string, unknown>)[key], key)
    }
  }
  tokens.push(punct(`${count ? ' ' : ''}${isArray ? ']' : '}'}`))
  return tokens
}

/**
 * Recursively flatten a value into JsonLine[]. `keyPrefix`, when provided, is
 * prepended to the opening line (e.g. `"name": `).
 */
function pushLines(
  value: unknown,
  depth: number,
  keyText: string | null,
  trailingComma: boolean,
  out: JsonLine[]
): void {
  const comma = trailingComma ? ',' : ''
  const keyPrefix = keyText === null ? '' : `${keyText}: `
  const keyToks: JsonToken[] =
    keyText === null ? [] : [{ text: keyText, cls: 'json-key' }, punct(': ')]
  const commaToks: JsonToken[] = comma ? [punct(comma)] : []

  // A plain array or plain (non-extended) object is a container — even when
  // empty (it renders as `{}` / `[]`). Everything else (scalars, extended EJSON
  // wrappers like {$oid}) is a leaf rendered via formatScalar.
  const isArray = Array.isArray(value)
  const isContainer =
    isArray || (typeof value === 'object' && value !== null && !isExtended(value))

  if (!isContainer) {
    const { type } = formatScalar(value)
    const valText = scalarText(value)
    out.push({
      depth,
      text: `${keyPrefix}${valText}${comma}`,
      tokens: [...keyToks, { text: valText, cls: `v-${type}` }, ...commaToks]
    })
    return
  }

  const open = isArray ? '[' : '{'
  const close = isArray ? ']' : '}'
  const entries = entriesOf(value)

  if (entries.length === 0) {
    out.push({
      depth,
      text: `${keyPrefix}${open}${close}${comma}`,
      tokens: [...keyToks, punct(`${open}${close}`), ...commaToks]
    })
    return
  }

  out.push({ depth, text: `${keyPrefix}${open}`, tokens: [...keyToks, punct(open)] })
  entries.forEach(([k, v], i) => {
    const last = i === entries.length - 1
    const childKey = isArray ? null : quoteKey(k)
    pushLines(v, depth + 1, childKey, !last, out)
  })
  out.push({ depth, text: `${close}${comma}`, tokens: [punct(close), ...commaToks] })
}

/** Flatten any EJSON value into virtualizable lines. */
export function toJsonLines(value: unknown): JsonLine[] {
  const out: JsonLine[] = []
  pushLines(value, 0, null, false, out)
  return out
}

/** Indentation string for a given depth (exported for the view to apply). */
export function indentFor(depth: number): string {
  return INDENT.repeat(depth)
}
