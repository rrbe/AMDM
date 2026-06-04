/**
 * Disconnect-race guards from catalog.ts. (catalog imports the sessionManager →
 * connectionStore chain, which pulls in `electron`; mock it so this runs in Node.)
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => import('../../helpers/electron-mock'))

import { isClientClosed, guardClosed } from '../../../src/main/mongo/catalog'

const named = (name: string, message = 'x'): Error => {
  const e = new Error(message)
  e.name = name
  return e
}

describe('isClientClosed', () => {
  it('recognizes the disconnect-race error names', () => {
    expect(isClientClosed(named('MongoClientClosedError'))).toBe(true)
    expect(isClientClosed(named('MongoNotConnectedError'))).toBe(true)
    expect(isClientClosed(named('MongoTopologyClosedError'))).toBe(true)
    expect(isClientClosed(named('MongoExpiredSessionError'))).toBe(true)
  })
  it('recognizes the disconnect-race messages', () => {
    expect(isClientClosed(new Error('client was closed'))).toBe(true)
    expect(isClientClosed(new Error('Connection is not open'))).toBe(true)
    expect(isClientClosed(new Error('Topology is closed'))).toBe(true)
  })
  it('returns false for unrelated errors and non-Errors', () => {
    expect(isClientClosed(new Error('boom'))).toBe(false)
    expect(isClientClosed('client was closed')).toBe(false) // not an Error instance
    expect(isClientClosed({ name: 'MongoClientClosedError' })).toBe(false)
    expect(isClientClosed(null)).toBe(false)
  })
})

describe('guardClosed', () => {
  it('returns the op result on success', async () => {
    await expect(guardClosed(async () => 42, -1)).resolves.toBe(42)
  })
  it('swallows a disconnect race and returns the fallback', async () => {
    await expect(
      guardClosed(async () => {
        throw named('MongoClientClosedError')
      }, [])
    ).resolves.toEqual([])
  })
  it('rethrows a genuine error', async () => {
    await expect(
      guardClosed(async () => {
        throw new Error('real failure')
      }, [])
    ).rejects.toThrow('real failure')
  })
})
