import { describe, expect, it } from 'vitest'
import { resultDataSize } from '../../../src/renderer/src/lib/resultDataSize'
import type { ShellResult } from '../../../src/shared/types'

const expectedSize = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).length

describe('result data size', () => {
  it('matches UTF-8 JSON bytes for EJSON, Unicode, escapes and Console output', async () => {
    const result: ShellResult = {
      kind: 'documents',
      data: [
        {
          _id: { $oid: '123' },
          text: '中文😀\n\t\u0000"\\\ud800',
          date: { $date: { $numberLong: '12' } },
          nil: null,
          missing: undefined,
          value: [1, true, undefined]
        }
      ],
      output: [
        { kind: 'text', text: 'hello' },
        { kind: 'json', data: { $numberDecimal: '12.50' } }
      ]
    }
    expect(await resultDataSize(result, new AbortController().signal)).toBe(expectedSize(result))
  })

  it('recomputes replacement results instead of using an older page size', async () => {
    const first: ShellResult = { kind: 'value', data: 'small' }
    const next = { ...first, data: 'larger result' }
    expect(await resultDataSize(first, new AbortController().signal)).toBe(expectedSize(first))
    expect(await resultDataSize(next, new AbortController().signal)).toBe(expectedSize(next))
  })

  it('yields and can cancel while scanning a large string without caching a partial size', async () => {
    const result: ShellResult = { kind: 'value', data: '😀'.repeat(500_000) }
    const controller = new AbortController()
    const pending = resultDataSize(result, controller.signal)
    controller.abort()
    expect(await pending).toBeNull()
    expect(await resultDataSize(result, new AbortController().signal)).toBe(expectedSize(result))
  })
})
