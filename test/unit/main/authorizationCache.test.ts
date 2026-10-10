import { describe, expect, it } from 'vitest'
import { AuthorizationCache, authorizationCacheKey } from '../../../src/main/mongo/authorizationCache'
import type { DecryptedConnection } from '../../../src/main/mongo/uri'

const dec: DecryptedConnection = {
  config: {
    id: 'c1',
    name: 'Test',
    host: 'localhost',
    port: 27017,
    useSrv: false,
    auth: { type: 'scram', username: 'ezze', authSource: 'ezze' },
    ssh: { enabled: false },
    tls: { enabled: false },
    createdAt: 0,
    updatedAt: 0
  },
  password: 'test-secret'
}
const result = { authorization: { users: [{ user: 'ezze', db: 'ezze' }], roles: [], privileges: [] } }

describe('authorization cache', () => {
  it('expires after five minutes without extending the lifetime on reads', () => {
    const cache = new AuthorizationCache()
    cache.set('key', result, 1000)
    expect(cache.get('key', 300_999)).toEqual(result)
    expect(cache.get('key', 301_000)).toBeNull()
  })

  it('refreshes successful results and discards a previous result on failed inspection', () => {
    const cache = new AuthorizationCache()
    cache.set('key', result, 0)
    cache.set('key', result, 1000)
    expect(cache.get('key', 300_000)).toEqual(result)
    cache.set('key', { authorizationError: 'unsupported' }, 300_000)
    expect(cache.get('key', 300_000)).toBeNull()
  })

  it('bounds the cache and clears it when the application closes', () => {
    const cache = new AuthorizationCache()
    for (let i = 0; i < 65; i++) cache.set(String(i), result, 0)
    expect(cache.get('0', 0)).toBeNull()
    expect(cache.get('64', 0)).toEqual(result)
    cache.clear()
    expect(cache.get('64', 0)).toBeNull()
  })

  it('matches reopened or saved configurations without retaining plaintext credentials in the key', () => {
    const key = authorizationCacheKey(dec)
    const reopened = {
      ...dec,
      config: {
        ...dec.config,
        id: 'saved',
        name: 'Renamed',
        color: '#ffffff',
        host: 'localhost:27017',
        port: undefined,
        updatedAt: 123,
        hasPassword: true
      }
    }
    expect(authorizationCacheKey(reopened)).toBe(key)
    expect(key).toMatch(/^[a-f0-9]{64}$/)
    expect(key).not.toContain('test-secret')
  })

  it('keeps the same SSH account cached when connection learns a trust pin', () => {
    const ssh = { ...dec, config: { ...dec.config, ssh: { enabled: true, host: 'jump', username: 'user' } } }
    expect(
      authorizationCacheKey({
        ...ssh,
        config: {
          ...ssh.config,
          ssh: { ...ssh.config.ssh, port: 22, authMethod: 'password', pinnedHostKey: 'learned' }
        }
      })
    ).toBe(authorizationCacheKey(ssh))
  })

  it('separates hosts, users, authentication databases, passwords, and SSH destinations', () => {
    const key = authorizationCacheKey(dec)
    for (const config of [
      { ...dec.config, host: 'other-host' },
      { ...dec.config, auth: { ...dec.config.auth, username: 'other-user' } },
      { ...dec.config, auth: { ...dec.config.auth, authSource: 'admin' } },
      { ...dec.config, ssh: { enabled: true, host: 'jump' } }
    ])
      expect(authorizationCacheKey({ ...dec, config })).not.toBe(key)
    expect(authorizationCacheKey({ ...dec, password: 'new-secret' })).not.toBe(key)
  })
})
