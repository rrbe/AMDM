import type { ShellResult } from '@shared/types'

const sizes = new WeakMap<ShellResult, number>()

/** UTF-8 JSON size without allocating a second serialized copy of the result. */
function* stringBytes(value: string): Generator<number> {
  let bytes = 2 // Quotes.
  let checkpoint = 0
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code === 34 || code === 92 || [8, 9, 10, 12, 13].includes(code)) bytes += 2
    else if (code < 32) bytes += 6
    else if (code < 128) bytes++
    else if (code < 2048) bytes += 2
    else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      value.charCodeAt(i + 1) >= 0xdc00 &&
      value.charCodeAt(i + 1) <= 0xdfff
    ) {
      bytes += 4
      i++
    } else if (code >= 0xd800 && code <= 0xdfff)
      bytes += 6 // JSON escapes lone surrogates.
    else bytes += 3
    if (i - checkpoint >= 1024) {
      checkpoint = i
      yield bytes
      bytes = 0
    }
  }
  yield bytes
}

function* jsonBytes(value: unknown): Generator<number> {
  if (typeof value === 'string') yield* stringBytes(value)
  else if (Array.isArray(value)) {
    yield 2
    for (let i = 0; i < value.length; i++) {
      if (i) yield 1
      yield* jsonBytes(value[i] ?? null)
    }
  } else if (value !== null && typeof value === 'object') {
    yield 2
    let first = true
    for (const key in value) {
      if (!Object.hasOwn(value, key)) continue
      const item = (value as Record<string, unknown>)[key]
      if (item === undefined) continue
      yield first ? 1 : 2 // Colon, plus comma after the first member.
      first = false
      yield* stringBytes(key)
      yield* jsonBytes(item)
    }
  } else yield JSON.stringify(value ?? null).length
}

/** Results are canonical EJSON; replacement objects invalidate the weak cache naturally. */
export async function resultDataSize(result: ShellResult, signal: AbortSignal): Promise<number | null> {
  if (signal.aborted) return null
  const cached = sizes.get(result)
  if (cached !== undefined) return cached
  let bytes = 0
  let steps = 0
  let start = performance.now()
  for (const part of jsonBytes(result)) {
    bytes += part
    if (++steps % 16 === 0 && performance.now() - start >= 4) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      if (signal.aborted) return null
      start = performance.now()
    }
  }
  sizes.set(result, bytes)
  return bytes
}
