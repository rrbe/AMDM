/**
 * Pure connection-backup core: build the export object + validate/coerce an
 * imported file. The effectful dialog/fs/store wiring (connectionBackup.ts) is
 * Electron-bound and stays out of the unit harness.
 */
import { describe, it, expect } from 'vitest'
import type { ConnectionConfig } from '../../../src/shared/types'
import {
  BACKUP_VERSION,
  buildBackup,
  parseBackupConnections
} from '../../../src/main/io/connectionBackupCore'

const sample = (over: Partial<ConnectionConfig> = {}): ConnectionConfig => ({
  id: 'c1',
  name: 'Local',
  color: '#3b82f6',
  useSrv: false,
  host: 'localhost',
  port: 27017,
  auth: { type: 'scram', username: 'admin', authSource: 'admin' },
  ssh: { enabled: false },
  tls: { enabled: false },
  hasPassword: true,
  hasSshPassword: false,
  hasSshPassphrase: false,
  createdAt: 1,
  updatedAt: 2,
  ...over
})

describe('buildBackup', () => {
  it('wraps configs with version + timestamp and drops id/timestamps', () => {
    const backup = buildBackup([sample()], 999)
    expect(backup.version).toBe(BACKUP_VERSION)
    expect(backup.exportedAt).toBe(999)
    expect(backup.connections).toHaveLength(1)
    const c = backup.connections[0] as Record<string, unknown>
    expect(c.id).toBeUndefined()
    expect(c.createdAt).toBeUndefined()
    expect(c.updatedAt).toBeUndefined()
    // Non-secret config is preserved.
    expect(c.name).toBe('Local')
    expect(c.host).toBe('localhost')
    expect((c.auth as { username: string }).username).toBe('admin')
  })

  it('never emits plaintext secrets (only indicator flags exist on the source)', () => {
    const json = JSON.stringify(buildBackup([sample()], 0))
    expect(json).not.toContain('password"')
    expect(json).not.toMatch(/encPassword|sshPassword|sshPassphrase/)
  })
})

describe('parseBackupConnections', () => {
  it('round-trips the wrapper shape, minting no ids (caller does)', () => {
    const backup = buildBackup([sample()], 0)
    const items = parseBackupConnections(backup)
    expect(items).toHaveLength(1)
    const it0 = items![0] as Record<string, unknown>
    expect(it0.id).toBeUndefined()
    expect(it0.name).toBe('Local')
  })

  it('accepts a bare array too', () => {
    const backup = buildBackup([sample(), sample({ name: 'Atlas', host: 'x.mongodb.net' })], 0)
    const items = parseBackupConnections(backup.connections)
    expect(items).toHaveLength(2)
  })

  it('returns null on an unrecognized top-level shape', () => {
    expect(parseBackupConnections({ foo: 1 })).toBeNull()
    expect(parseBackupConnections('nope')).toBeNull()
    expect(parseBackupConnections(null)).toBeNull()
  })

  it('skips malformed entries (missing name/host/auth) rather than aborting', () => {
    const items = parseBackupConnections([
      sample(),
      { name: 'no-host' }, // missing host
      { host: 'no-name' }, // missing name
      { name: 'no-auth', host: 'h', ssh: {}, tls: {} }, // missing auth
      sample({ name: 'ok2' })
    ])
    expect(items?.map((i) => i.name)).toEqual(['Local', 'ok2'])
  })

  it('drops any stray secret-ish fields on import', () => {
    const items = parseBackupConnections([
      { ...sample(), password: 'leaked', sshPassphrase: 'leaked2' } as unknown
    ])
    const it0 = items![0] as Record<string, unknown>
    expect(it0.password).toBeUndefined()
    expect(it0.sshPassphrase).toBeUndefined()
  })
})
