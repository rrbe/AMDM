import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ConnectionInput } from '../../../src/shared/types'
import { WebStore } from '../../../src/web/webStore'

function input(password = 'secret'): ConnectionInput {
  return {
    id: crypto.randomUUID(),
    name: 'Mongo',
    useSrv: false,
    host: 'localhost:27017',
    auth: { type: 'scram', username: 'user' },
    password,
    ssh: { enabled: false },
    tls: { enabled: false }
  }
}

function files(root: string): string[] {
  const result: string[] = []
  const walk = (dir: string): void => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, item.name)
      if (item.isDirectory()) walk(path)
      else result.push(path)
    }
  }
  walk(root)
  return result
}

describe('WebStore', () => {
  it('encrypts credentials and isolates each SSO user', () => {
    const root = mkdtempSync(join(tmpdir(), 'amdm-web-store-'))
    const store = new WebStore(root, Buffer.alloc(32, 1))
    const saved = store.saveConnection('alice@example.com', input())

    expect(store.listConnections('alice@example.com')).toMatchObject([{ id: saved.id, hasPassword: true }])
    expect(store.listConnections('bob@example.com')).toEqual([])
    expect(() => store.sessionId('bob@example.com', saved.id)).toThrow('Connection not found')
    expect(store.getDecrypted(store.sessionId('alice@example.com', saved.id))?.password).toBe('secret')
    expect(
      files(root)
        .map((path) => readFileSync(path, 'utf8'))
        .join('\n')
    ).not.toContain('secret')
  })

  it('preserves omitted passwords, rejects SSH, and detects a wrong key', () => {
    const root = mkdtempSync(join(tmpdir(), 'amdm-web-store-'))
    const store = new WebStore(root, Buffer.alloc(32, 2))
    const original = input()
    const saved = store.saveConnection('alice', original)
    store.saveConnection('alice', {
      ...original,
      id: saved.id,
      password: undefined,
      name: 'Renamed'
    })
    expect(store.getDecrypted(store.sessionId('alice', saved.id))?.password).toBe('secret')
    expect(() => store.saveConnection('alice', { ...input(), ssh: { enabled: true } })).toThrow('SSH')

    const wrongKey = new WebStore(root, Buffer.alloc(32, 3))
    expect(() => wrongKey.getDecrypted(wrongKey.sessionId('alice', saved.id))).toThrow()
  })

  it('validates settings and writes redacted audit records', () => {
    const root = mkdtempSync(join(tmpdir(), 'amdm-web-store-'))
    const store = new WebStore(root, Buffer.alloc(32, 4))
    expect(store.updateSettings('alice', { theme: 'dark' }).theme).toBe('dark')
    expect(() => store.updateSettings('alice', { theme: 'invalid' as 'dark' })).toThrow('Invalid settings')
    store.audit({
      user: 'alice',
      action: 'doc:delete',
      connectionId: 'c1',
      database: 'db',
      collection: 'items',
      documentId: { $oid: 'abc' },
      ok: true
    })
    const audit = readFileSync(join(root, 'audit.ndjson'), 'utf8')
    expect(JSON.parse(audit)).toMatchObject({
      user: 'alice',
      action: 'doc:delete',
      ok: true
    })
  })
})
