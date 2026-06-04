/**
 * JSON-backed stores: queries/history, settings merge, and connection secrets.
 * Electron's app + safeStorage are faked (see helpers/electron-mock.ts) and each
 * test runs against a fresh temp userData dir.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('electron', () => import('../../helpers/electron-mock'))

import * as electron from '../../helpers/electron-mock'
import { queryStore } from '../../../src/main/store/queryStore'
import { settingsStore } from '../../../src/main/store/settingsStore'
import { connectionStore } from '../../../src/main/store/connectionStore'
import type { ConnectionInput } from '../../../src/shared/types'

let dir = ''

beforeEach(() => {
  dir = electron.freshUserDataDir()
  electron.safeStorage.available = true
  // Seed empty store files so init() resets in-memory state (init only reloads
  // when the file exists; a fresh dir alone would keep the prior test's data).
  electron.seedStoreFile('queries.json', { version: 1, queries: [], history: [] })
  electron.seedStoreFile('settings.json', { version: 1 })
  electron.seedStoreFile('connections.json', { version: 1, connections: [] })
  queryStore.init()
  settingsStore.init()
  connectionStore.init()
})

describe('queryStore — saved queries', () => {
  it('upserts by id (save then update keeps a single entry)', () => {
    const saved = queryStore.saveQuery({ name: 'q1', code: 'db.a.find()' })
    expect(queryStore.listQueries()).toHaveLength(1)
    const updated = queryStore.saveQuery({ id: saved.id, name: 'q1-renamed', code: 'db.b.find()' })
    expect(updated.id).toBe(saved.id)
    expect(queryStore.listQueries()).toHaveLength(1)
    expect(queryStore.listQueries()[0].name).toBe('q1-renamed')
  })
  it('deletes by id', () => {
    const saved = queryStore.saveQuery({ name: 'q', code: 'c' })
    queryStore.deleteQuery(saved.id)
    expect(queryStore.listQueries()).toEqual([])
  })
})

describe('queryStore — history', () => {
  const entry = (code: string) => ({ code, connectionId: 'c', database: 'd', ok: true })

  it('prepends newest-first and caps at 200', () => {
    for (let i = 0; i < 205; i++) queryStore.addHistory(entry(String(i)))
    const hist = queryStore.listHistory()
    expect(hist).toHaveLength(200)
    expect(hist[0].code).toBe('204') // newest first
    expect(hist[199].code).toBe('5') // oldest kept (0..4 dropped)
  })
  it('clears history', () => {
    queryStore.addHistory(entry('x'))
    queryStore.clearHistory()
    expect(queryStore.listHistory()).toEqual([])
  })
})

describe('settingsStore', () => {
  it('returns defaults when nothing is stored', () => {
    expect(settingsStore.get()).toMatchObject({ queryLimit: 50, theme: 'system', sidebarWidth: 300 })
  })
  it('merges + persists an update', () => {
    const next = settingsStore.update({ queryLimit: 100 })
    expect(next.queryLimit).toBe(100)
    expect(settingsStore.get().theme).toBe('system') // untouched
  })
  it('merges stored settings over defaults on load (forward-compatible upgrade)', () => {
    electron.seedStoreFile('settings.json', { version: 1, settings: { theme: 'dark' } })
    settingsStore.init()
    expect(settingsStore.get()).toMatchObject({ theme: 'dark', queryLimit: 50, sidebarWidth: 300 })
  })
})

describe('connectionStore — secret handling', () => {
  const input = (over: Partial<ConnectionInput> = {}): ConnectionInput => ({
    name: 'conn',
    useSrv: false,
    host: 'h',
    port: 27017,
    auth: { type: 'none' },
    ssh: { enabled: false },
    tls: { enabled: false },
    ...over
  })

  it('sanitized output exposes has* flags but no secret material', () => {
    const saved = connectionStore.saveConnection(input({ password: 'secret' }))
    expect(saved.hasPassword).toBe(true)
    expect(saved).not.toHaveProperty('password')
    expect(saved).not.toHaveProperty('encPassword')
    expect(connectionStore.listConnections()[0].hasPassword).toBe(true)
  })

  it('never writes the plaintext secret to disk', () => {
    connectionStore.saveConnection(input({ password: 'secret' }))
    const onDisk = readFileSync(join(dir, 'connections.json'), 'utf8')
    expect(onDisk).not.toContain('secret')
  })

  it('round-trips the secret through getDecrypted', () => {
    const saved = connectionStore.saveConnection(input({ password: 'secret' }))
    expect(connectionStore.getDecrypted(saved.id)?.password).toBe('secret')
  })

  it('nextSecret: undefined keeps, "" clears, a value replaces', () => {
    const saved = connectionStore.saveConnection(input({ password: 'secret' }))
    // undefined → keep the existing secret
    connectionStore.saveConnection(input({ id: saved.id, host: 'h2' }))
    expect(connectionStore.getDecrypted(saved.id)?.password).toBe('secret')
    // a new value → replace
    connectionStore.saveConnection(input({ id: saved.id, password: 'rotated' }))
    expect(connectionStore.getDecrypted(saved.id)?.password).toBe('rotated')
    // '' → clear
    const cleared = connectionStore.saveConnection(input({ id: saved.id, password: '' }))
    expect(cleared.hasPassword).toBe(false)
    expect(connectionStore.getDecrypted(saved.id)?.password).toBeUndefined()
  })

  it('encrypts SSH passphrases too', () => {
    const saved = connectionStore.saveConnection(
      input({ ssh: { enabled: true, host: 'gw' }, sshPassphrase: 'pp' })
    )
    expect(saved.hasSshPassphrase).toBe(true)
    expect(connectionStore.getDecrypted(saved.id)?.sshPassphrase).toBe('pp')
  })

  it('falls back to the dev path when OS encryption is unavailable, still round-tripping', () => {
    electron.safeStorage.available = false
    const saved = connectionStore.saveConnection(input({ password: 'secret' }))
    expect(saved.hasPassword).toBe(true)
    expect(connectionStore.getDecrypted(saved.id)?.password).toBe('secret')
    const onDisk = readFileSync(join(dir, 'connections.json'), 'utf8')
    expect(onDisk).not.toContain('secret') // base64'd, not plaintext
  })

  it('deletes a connection', () => {
    const saved = connectionStore.saveConnection(input())
    connectionStore.deleteConnection(saved.id)
    expect(connectionStore.listConnections()).toEqual([])
  })
})
