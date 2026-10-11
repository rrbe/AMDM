import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../src/shared/ipc'
import type { ConnectionInput } from '../../src/shared/types'

const bridge = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  api: undefined as Api | undefined
}))

vi.mock('electron', async () => ({
  ...(await import('../helpers/electron-mock')),
  contextBridge: {
    exposeInMainWorld: (_name: string, api: Api) => {
      bridge.api = api
    }
  },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      bridge.handlers.set(channel, handler)
    }
  },
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]) =>
      Promise.resolve().then(() => {
        const handler = bridge.handlers.get(channel)
        if (!handler) throw new Error(`No IPC handler for ${channel}`)
        return handler({}, ...args)
      })
  },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: {}
}))

vi.mock('../../src/main/ipc/registerUpdatesIpc', () => ({ registerUpdatesIpc: vi.fn() }))

import '../../src/preload/index'
import { registerIpc } from '../../src/main/ipc/registerIpc'
import { connectionStore } from '../../src/main/store/connectionStore'
import { sessionManager } from '../../src/main/mongo/sessionManager'
import * as electron from '../helpers/electron-mock'
import { startMongo } from '../helpers/mongo'

let dir = ''
const input: ConnectionInput = {
  id: '',
  name: 'Original',
  color: '#3b82f6',
  useSrv: false,
  host: 'db.example.test',
  port: 27017,
  replicaSet: 'rs0',
  defaultDatabase: 'shop',
  options: { readPreference: 'secondaryPreferred' },
  auth: { type: 'scram', username: 'reader', authSource: 'admin' },
  ssh: {
    enabled: true,
    host: 'ssh.example.test',
    username: 'user',
    privateKeyPath: '/keys/ssh',
    jump: { host: 'jump.example.test', port: 22, username: 'jump', privateKeyPath: '/keys/jump' }
  },
  tls: { enabled: true, caFile: '/certs/ca.pem' },
  password: 'mongo-secret',
  sshPassword: 'ssh-secret',
  sshPassphrase: 'ssh-passphrase',
  jumpSshPassphrase: 'jump-passphrase'
}

describe('connection duplication through IPC', () => {
  beforeAll(() => registerIpc(vi.fn()))
  beforeEach(() => {
    dir = electron.freshUserDataDir()
    electron.seedStoreFile('connections.json', { version: 1, connections: [] })
    connectionStore.init()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(dir, { recursive: true, force: true })
  })

  it('persists an independent copy with all secrets, without exposing secret material over IPC', async () => {
    const api = bridge.api!
    const source = await api.connections.save(input)
    const copy = await api.connections.save({ ...source, copyFromId: source.id, name: 'Original (copy)' })
    expect(copy).toEqual({
      ...source,
      id: expect.any(String),
      name: 'Original (copy)',
      createdAt: expect.any(Number),
      updatedAt: expect.any(Number)
    })
    expect(copy.id).not.toBe(source.id)
    expect(copy).not.toHaveProperty('copyFromId')
    expect(connectionStore.getDecrypted(copy.id)).toMatchObject({
      password: input.password,
      sshPassword: input.sshPassword,
      sshPassphrase: input.sshPassphrase,
      jumpSshPassphrase: input.jumpSshPassphrase
    })
    const wire = JSON.stringify(copy)
    for (const field of ['password', 'sshPassword', 'sshPassphrase', 'jumpSshPassphrase'] as const) {
      expect(wire).not.toContain(input[field])
      expect(copy).not.toHaveProperty(field)
    }
    expect(wire).not.toContain('encPassword')
    expect(wire).not.toContain('encSsh')
    expect(wire).not.toContain('encJump')
    const onDisk = readFileSync(join(dir, 'connections.json'), 'utf8')
    expect(onDisk).not.toContain(input.password)

    await api.connections.save({ ...copy, name: 'Modified', host: 'other.example.test', password: 'new-secret' })
    connectionStore.init()
    expect(await api.connections.list()).toHaveLength(2)
    expect(connectionStore.getDecrypted(source.id)).toMatchObject({ config: source, password: input.password })
    expect(connectionStore.getDecrypted(copy.id)).toMatchObject({
      config: { name: 'Modified', host: 'other.example.test' },
      password: 'new-secret',
      sshPassword: input.sshPassword,
      sshPassphrase: input.sshPassphrase,
      jumpSshPassphrase: input.jumpSshPassphrase
    })
  })

  it('tests and exports a draft using its source credentials while keeping persistence unchanged', async () => {
    const api = bridge.api!
    const source = await api.connections.save(input)
    const draft = { ...source, id: '', copyFromId: source.id, name: 'Draft', host: 'other.example.test' }
    const onDisk = readFileSync(join(dir, 'connections.json'), 'utf8')
    const test = vi.spyOn(sessionManager, 'test').mockResolvedValue({ ok: true })
    await api.connections.test(draft)
    expect(test).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({ host: draft.host }),
      password: input.password,
      sshPassword: input.sshPassword,
      sshPassphrase: input.sshPassphrase,
      jumpSshPassphrase: input.jumpSshPassphrase
    }))
    expect(await api.connections.buildUri(draft, { includePassword: true })).toContain('mongo-secret@other.example.test')
    expect(await api.connections.list()).toEqual([source])
    expect(readFileSync(join(dir, 'connections.json'), 'utf8')).toBe(onDisk)
  })

  it('saves edited draft fields and replaced or cleared secrets independently', async () => {
    const api = bridge.api!
    const source = await api.connections.save(input)
    const copy = await api.connections.save({
      ...source,
      id: '',
      copyFromId: source.id,
      name: 'Edited copy',
      host: 'other.example.test',
      password: 'new-secret',
      sshPassword: '',
      sshPassphrase: '',
      jumpSshPassphrase: 'new-jump-secret'
    })
    expect(connectionStore.getDecrypted(copy.id)).toMatchObject({
      config: { name: 'Edited copy', host: 'other.example.test' },
      password: 'new-secret',
      sshPassword: undefined,
      sshPassphrase: undefined,
      jumpSshPassphrase: 'new-jump-secret'
    })
    expect(connectionStore.getDecrypted(source.id)).toMatchObject({
      config: source,
      password: input.password,
      sshPassword: input.sshPassword,
      sshPassphrase: input.sshPassphrase,
      jumpSshPassphrase: input.jumpSshPassphrase
    })
  })

  it('returns the authenticated account permissions through test and live-session IPC without persisting them', async () => {
    const harness = await startMongo()
    try {
      await harness.client.db('ezze').command({
        createUser: 'ezze', pwd: 'test-password', roles: [{ role: 'readWrite', db: 'ezze' }]
      })
      const api = bridge.api!
      const uri = new URL(harness.server.getUri())
      const onDisk = readFileSync(join(dir, 'connections.json'), 'utf8')
      const testInput: ConnectionInput = {
        id: '', name: 'Permission test', host: uri.hostname, port: Number(uri.port), useSrv: false,
        auth: { type: 'scram', username: 'ezze', authSource: 'ezze' }, password: 'test-password',
        ssh: { enabled: false }, tls: { enabled: false }
      }
      const result = await api.connections.test(testInput)
      expect(result.ok).toBe(true)
      expect(result.authorizationError).toBeUndefined()
      expect(result.authorization?.users).toEqual([{ user: 'ezze', db: 'ezze' }])
      expect(result.authorization?.roles).toEqual([{ role: 'readWrite', db: 'ezze' }])
      expect(result.authorization?.privileges).toContainEqual({
        resource: { db: 'ezze', collection: '' }, actions: expect.arrayContaining(['find', 'insert', 'update', 'remove'])
      })
      const wire = JSON.stringify(result)
      expect(wire).not.toContain('test-password')
      expect(wire).not.toContain('clusterTime')
      expect(wire).not.toContain('credentials')
      expect(readFileSync(join(dir, 'connections.json'), 'utf8')).toBe(onDisk)

      expect(await api.connections.cachedAuthorization({ ...testInput, name: 'Renamed' })).toEqual({ authorization: result.authorization })
      expect(await api.connections.cachedAuthorization({ ...testInput, password: 'other-password' })).toBeNull()
      expect(await api.connections.cachedAuthorization({ ...testInput, auth: { ...testInput.auth, username: 'other' } })).toBeNull()
      expect(await api.connections.list()).toEqual([])

      const saved = await api.connections.save(testInput)
      expect(await api.connections.cachedAuthorization(saved)).toEqual({ authorization: result.authorization })
      const now = Date.now()
      const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 5 * 60 * 1000)
      expect(await api.connections.cachedAuthorization(saved)).toBeNull()
      clock.mockRestore()
      try {
        await api.session.connect(saved.id)
        expect(await api.session.authorization(saved.id, saved)).toEqual({ authorization: result.authorization })
        const db = vi.spyOn(sessionManager.getClient(saved.id), 'db')
        expect(await api.session.authorization(saved.id, saved)).toEqual({ authorization: result.authorization })
        expect(await api.session.authorization(saved.id, {
          ...saved, auth: { ...saved.auth, username: 'different-user' }
        })).toEqual({})
        expect(db).not.toHaveBeenCalled()
        await api.session.disconnect(saved.id)
        expect(await api.connections.cachedAuthorization(saved)).toEqual({ authorization: result.authorization })
      } finally {
        await api.session.disconnect(saved.id)
      }
    } finally {
      await harness.stop()
    }
  })

  it('rejects a missing source without creating a connection', async () => {
    await expect(bridge.api!.connections.save({ ...input, copyFromId: 'missing' })).rejects.toThrow('Source connection not found')
    expect(await bridge.api!.connections.list()).toEqual([])
  })
})
