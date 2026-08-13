import { describe, expect, it, vi } from 'vitest'
import { randomUuid } from '../../../src/renderer/src/lib/randomUuid'

describe('randomUuid', () => {
  it('uses the native implementation when available', () => {
    const nativeUuid = '12345678-1234-4123-8123-123456789abc'
    const randomUUID = vi.fn(() => nativeUuid)

    expect(
      randomUuid({
        randomUUID,
        getRandomValues: vi.fn()
      })
    ).toBe(nativeUuid)
    expect(randomUUID).toHaveBeenCalledOnce()
  })

  it('generates a version 4 UUID when randomUUID is unavailable', () => {
    const getRandomValues = (array: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> => {
      array.set(Array.from({ length: 16 }, (_, index) => index))
      return array
    }

    expect(randomUuid({ getRandomValues })).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f')
  })
})
