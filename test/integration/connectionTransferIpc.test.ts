import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../src/shared/ipc'
import type {
  ConnectionImportPreview,
  ConnectionImportRequest,
  ConnectionTransferApi
} from '../../src/shared/connectionTransfer'
import type { ConnectionInput } from '../../src/shared/types'

const bridge = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  api: undefined as Api | undefined,
  sender: undefined as unknown,
  owner: { isDestroyed: () => false },
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
  writeText: vi.fn(),
  getStatus: vi.fn(),
  onStatusChanged: vi.fn(() => vi.fn())
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
    invoke: (channel: string, ...args: unknown[]) => {
      const sender = bridge.sender
      return Promise.resolve().then(() => {
        const handler = bridge.handlers.get(channel)
        if (!handler) throw new Error(`No IPC handler for ${channel}`)
        return handler({ sender }, ...args)
      })
    }
  },
  BrowserWindow: { fromWebContents: () => bridge.owner },
  dialog: {
    showOpenDialog: bridge.showOpenDialog,
    showSaveDialog: bridge.showSaveDialog
  },
  clipboard: { writeText: bridge.writeText }
}))

vi.mock('../../src/main/mongo/desktopSession', () => ({
  sessionManager: {
    getStatus: bridge.getStatus,
    onStatusChanged: bridge.onStatusChanged
  }
}))

import '../../src/preload/index'
import { registerConnectionTransferIpc } from '../../src/main/ipc/registerConnectionTransferIpc'
import { encodeConnections } from '../../src/main/io/connectionTransferCore'
import { connectionStore } from '../../src/main/store/connectionStore'
import { settingsStore } from '../../src/main/store/settingsStore'
import * as electron from '../helpers/electron-mock'

const secretFields = ['password', 'sshPassword', 'sshPassphrase', 'jumpSshPassphrase'] as const
const input: ConnectionInput = {
  id: 'source-id',
  name: 'Original',
  host: 'db.example.test',
  port: 27017,
  useSrv: false,
  auth: { type: 'scram', username: 'reader', authSource: 'admin' },
  ssh: {
    enabled: true,
    host: 'ssh.example.test',
    username: 'ssh-user',
    privateKeyPath: '/keys/id',
    jump: {
      host: 'jump.example.test',
      port: 22,
      username: 'jump-user',
      privateKeyPath: '/keys/jump'
    }
  },
  tls: { enabled: false },
  password: 'mongo-transfer-secret',
  sshPassword: 'ssh-transfer-secret',
  sshPassphrase: 'key-transfer-secret',
  jumpSshPassphrase: 'jump-transfer-secret'
}
const simple: ConnectionInput = {
  id: '',
  name: 'Simple',
  host: 'simple.example.test',
  useSrv: false,
  auth: { type: 'none' },
  ssh: { enabled: false },
  tls: { enabled: false }
}

function sender(id: number) {
  return Object.assign(new EventEmitter(), {
    id,
    isDestroyed: () => false,
    getURL: () => 'file:///amdm/renderer/index.html'
  })
}

let dir = ''
let api: ConnectionTransferApi
let owner: ReturnType<typeof sender>

function snapshot() {
  return {
    connections: connectionStore.listConnections(),
    settings: structuredClone(settingsStore.get()),
    connectionsFile: readFileSync(join(dir, 'connections.json'), 'utf8'),
    settingsFile: readFileSync(join(dir, 'settings.json'), 'utf8')
  }
}

function expectSanitized(value: unknown) {
  const wire = JSON.stringify(value)
  for (const field of secretFields) {
    expect(wire).not.toContain(input[field])
    expect(wire).not.toContain(`"${field}":`)
  }
  for (const field of [
    'encPassword',
    'encSshPassword',
    'encSshPassphrase',
    'encJumpSshPassphrase'
  ]) {
    expect(wire).not.toContain(field)
  }
}

async function previewText(text: string, fileName = 'connections.json') {
  const path = join(dir, 'fixtures', fileName)
  writeFileSync(path, text, 'utf8')
  bridge.showOpenDialog.mockResolvedValueOnce({
    canceled: false,
    filePaths: [path]
  })
  const preview = await api.preview({})
  expect(preview).not.toBeNull()
  return preview!
}

async function previewInputs(inputs: ConnectionInput[], passphrase?: string) {
  const encoded = await encodeConnections(inputs, 'amdm', !!passphrase, passphrase)
  return previewText(encoded)
}

async function previewWithSecrets(inputs: ConnectionInput[]) {
  const locked = await previewInputs(inputs, 'test-import-passphrase')
  const preview = await api.preview({
    token: locked.token,
    passphrase: 'test-import-passphrase'
  })
  expect(preview?.error).toBeUndefined()
  return preview!
}

function apply(
  preview: ConnectionImportPreview,
  entries: ConnectionImportRequest['entries'] = preview.rows.map((row) => ({
    index: row.index
  }))
) {
  return api.apply({
    token: preview.token,
    entries,
    acknowledgeWarnings: true
  })
}

describe('connection transfer through the preload and IPC', () => {
  beforeAll(() => registerConnectionTransferIpc())
  beforeEach(() => {
    vi.clearAllMocks()
    bridge.showOpenDialog.mockReset().mockResolvedValue({ canceled: true, filePaths: [] })
    bridge.showSaveDialog.mockReset().mockResolvedValue({ canceled: true })
    bridge.writeText.mockReset()
    bridge.getStatus.mockReset().mockImplementation((id: string) => ({ id, state: 'disconnected' }))
    owner = sender(1)
    bridge.sender = owner
    dir = electron.freshUserDataDir()
    mkdirSync(join(dir, 'fixtures'))
    electron.safeStorage.available = true
    electron.seedStoreFile('connections.json', { version: 1, connections: [] })
    electron.seedStoreFile('settings.json', { version: 1, settings: {} })
    connectionStore.init()
    settingsStore.init()
    api = bridge.api!.connectionTransfer!
  })
  afterEach(() => {
    owner.emit('destroyed')
    vi.useRealTimers()
    vi.restoreAllMocks()
    rmSync(dir, { recursive: true, force: true })
  })

  it('previews a native file without persisting or returning source text, paths, or secrets', async () => {
    const before = snapshot()
    const preview = await previewInputs([input])
    expect(preview.error).toBeUndefined()
    expect(preview.token).toEqual(expect.any(String))
    expect(preview.fileName).toBe('connections.json')
    expect(preview.rows).toHaveLength(1)
    expect(preview.rows[0]).toMatchObject({
      index: 0,
      name: input.name,
      config: { host: input.host }
    })
    expectSanitized(preview)
    expect(preview).not.toHaveProperty('text')
    expect(JSON.stringify(preview)).not.toContain(dir)
    expect(bridge.showOpenDialog).toHaveBeenCalledWith(
      bridge.owner,
      expect.objectContaining({ properties: ['openFile'] })
    )
    expect(snapshot()).toEqual(before)
  })

  it('unlocks an encrypted preview in main and rejects a wrong password without writes', async () => {
    const before = snapshot()
    const locked = await previewInputs([input], 'transfer-file-passphrase')
    expect(locked).toMatchObject({ needsPassword: true, rows: [] })
    expectSanitized(locked)
    expect((await apply(locked, [{ index: 0 }])).error).toBeDefined()
    const wrong = await api.preview({
      token: locked.token,
      passphrase: 'wrong-passphrase'
    })
    expect(wrong?.error).toBeDefined()
    expectSanitized(wrong)
    expect(snapshot()).toEqual(before)
    const unlocked = await api.preview({
      token: locked.token,
      passphrase: 'transfer-file-passphrase'
    })
    expect(unlocked?.error).toBeUndefined()
    expect(unlocked?.rows).toHaveLength(1)
    expectSanitized(unlocked)
    const result = await apply(unlocked!)
    expect(result.error).toBeUndefined()
    expect(result.count).toBe(1)
    expectSanitized(result)
    expect(connectionStore.getDecrypted(result.connections![0].id)).toMatchObject({
      password: input.password
    })
    expect(bridge.showOpenDialog).toHaveBeenCalledTimes(1)
  })

  it('imports clones with unique names, encrypted secrets, stable order, and a single atomic store call', async () => {
    const existing = connectionStore.saveConnection(input)
    settingsStore.update({ connectionOrder: [existing.id] })
    const preview = await previewWithSecrets([
      input,
      { ...input, id: 'second-source-id', host: 'second.example.test' }
    ])
    const atomicImport = vi.spyOn(connectionStore, 'importConnections')
    const result = await apply(preview)
    expect(result.error).toBeUndefined()
    expect(result.count).toBe(2)
    expect(result.replacedIds).toEqual([])
    expect(atomicImport).toHaveBeenCalledTimes(1)
    expectSanitized(result)
    const connections = connectionStore.listConnections()
    expect(connections).toHaveLength(3)
    expect(connections[0]).toEqual(existing)
    expect(new Set(connections.map((row) => row.id)).size).toBe(3)
    expect(new Set(connections.map((row) => row.name)).size).toBe(3)
    expect(connections.map((row) => row.name)).toEqual(['Original', 'Original (2)', 'Original (3)'])
    expect(connections.map((row) => row.host)).toEqual([
      input.host,
      input.host,
      'second.example.test'
    ])
    expect(settingsStore.get().connectionOrder).toEqual([existing.id])
    expect(result.settings).toEqual(settingsStore.get())
    for (const connection of connections.slice(1)) {
      expect(connectionStore.getDecrypted(connection.id)).toMatchObject(
        Object.fromEntries(secretFields.map((field) => [field, input[field]]))
      )
    }
    const disk = readFileSync(join(dir, 'connections.json'), 'utf8')
    for (const field of secretFields) expect(disk).not.toContain(input[field])
    expect(disk).toContain('encPassword')
    connectionStore.init()
    settingsStore.init()
    expect(connectionStore.listConnections()).toEqual(connections)
    expect(settingsStore.get().connectionOrder).toEqual([existing.id])
    expect((await apply(preview)).error).toBeDefined()
    expect(connectionStore.listConnections()).toEqual(connections)
  })

  it('preserves file order even when the requested selection is reversed', async () => {
    const preview = await previewInputs([
      { ...simple, name: 'First' },
      { ...simple, name: 'Second' }
    ])
    const result = await apply(preview, [{ index: 1 }, { index: 0 }])
    expect(result.error).toBeUndefined()
    const connections = connectionStore.listConnections()
    expect(connections.map((row) => row.name)).toEqual(['First', 'Second'])
    expect(settingsStore.get().connectionOrder).toEqual([])
  })

  it('replaces an offline connection and clears every credential absent from the imported row', async () => {
    const target = connectionStore.saveConnection(input)
    const other = connectionStore.saveConnection({ ...simple, name: 'Keep' })
    settingsStore.update({ connectionOrder: [other.id, target.id] })
    const preview = await previewInputs([{ ...simple, name: 'Replacement' }])
    const result = await api.apply({
      token: preview.token,
      entries: [{ index: 0, replaceId: target.id }],
      acknowledgeWarnings: true
    })
    expect(result.error).toBeUndefined()
    expect(result.count).toBe(1)
    expect(result.replacedIds).toEqual([target.id])
    expect(connectionStore.listConnections()).toHaveLength(2)
    expect(connectionStore.getDecrypted(target.id)).toMatchObject({
      config: {
        id: target.id,
        name: 'Replacement',
        host: simple.host,
        hasPassword: false,
        hasSshPassword: false,
        hasSshPassphrase: false,
        hasJumpSshPassphrase: false
      },
      password: undefined,
      sshPassword: undefined,
      sshPassphrase: undefined,
      jumpSshPassphrase: undefined
    })
    expect(connectionStore.getDecrypted(other.id)?.config).toEqual(other)
    expect(settingsStore.get().connectionOrder).toEqual([other.id, target.id])
    expectSanitized(result)
  })

  it.each(['connected', 'connecting', 'error'] as const)(
    'preflights the entire plan before rejecting a %s replacement',
    async (state) => {
      const target = connectionStore.saveConnection(input)
      const before = snapshot()
      const preview = await previewInputs([
        { ...simple, name: 'Would create' },
        { ...simple, name: 'Would replace' }
      ])
      bridge.getStatus.mockImplementation((id: string) => ({ id, state }))
      const atomicImport = vi.spyOn(connectionStore, 'importConnections')
      const result = await api.apply({
        token: preview.token,
        entries: [{ index: 0 }, { index: 1, replaceId: target.id }],
        acknowledgeWarnings: true
      })
      expect(result.error).toBeDefined()
      expect(atomicImport).not.toHaveBeenCalled()
      expect(snapshot()).toEqual(before)
    }
  )

  it.each([
    { name: 'duplicate rows', entries: [{ index: 0 }, { index: 0 }] },
    {
      name: 'an out-of-range row after a valid row',
      entries: [{ index: 0 }, { index: 5 }]
    },
    { name: 'a negative row', entries: [{ index: -1 }] },
    { name: 'a fractional row', entries: [{ index: 0.5 }] },
    {
      name: 'a missing replacement',
      entries: [{ index: 0 }, { index: 1, replaceId: 'missing' }]
    },
    { name: 'an empty selection', entries: [] }
  ])('rejects $name without partially writing', async ({ entries }) => {
    const preview = await previewInputs([
      { ...simple, name: 'One' },
      { ...simple, name: 'Two' }
    ])
    const before = snapshot()
    const atomicImport = vi.spyOn(connectionStore, 'importConnections')
    expect((await apply(preview, entries)).error).toBeDefined()
    expect(atomicImport).not.toHaveBeenCalled()
    expect(snapshot()).toEqual(before)
  })

  it('rejects two rows replacing the same connection before any write', async () => {
    const target = connectionStore.saveConnection(input)
    const preview = await previewInputs([
      { ...simple, name: 'One' },
      { ...simple, name: 'Two' }
    ])
    const before = snapshot()
    const atomicImport = vi.spyOn(connectionStore, 'importConnections')
    const result = await api.apply({
      token: preview.token,
      entries: [
        { index: 0, replaceId: target.id },
        { index: 1, replaceId: target.id }
      ],
      acknowledgeWarnings: true
    })
    expect(result.error).toBeDefined()
    expect(atomicImport).not.toHaveBeenCalled()
    expect(snapshot()).toEqual(before)
  })

  it('leaves memory and disk unchanged if preparing a later imported credential fails', async () => {
    const preview = await previewWithSecrets([{ ...simple, name: 'Would create' }, input])
    const before = snapshot()
    vi.spyOn(electron.safeStorage, 'encryptString').mockImplementationOnce(() => {
      throw new Error('encryption unavailable')
    })
    const result = await apply(preview)
    expect(result.error).toBeDefined()
    expect(snapshot()).toEqual(before)
    connectionStore.init()
    expect(snapshot()).toEqual(before)
  })

  it('isolates preview tokens by WebContents, including decrypt and release', async () => {
    const preview = await previewInputs([input], 'owner-passphrase')
    const before = snapshot()
    bridge.sender = sender(2)
    expect(
      (
        await api.preview({
          token: preview.token,
          passphrase: 'owner-passphrase'
        })
      )?.error
    ).toBeDefined()
    expect((await apply(preview, [{ index: 0 }])).error).toBeDefined()
    await api.release(preview.token)
    expect(snapshot()).toEqual(before)
    bridge.sender = owner
    const unlocked = await api.preview({
      token: preview.token,
      passphrase: 'owner-passphrase'
    })
    expect(unlocked?.error).toBeUndefined()
    expect(unlocked?.rows).toHaveLength(1)
    expect((await apply(unlocked!)).count).toBe(1)
  })

  it.each(['release', 'destroyed', 'did-navigate', 'render-process-gone'] as const)(
    'invalidates a preview after owner %s',
    async (action) => {
      const preview = await previewInputs([simple])
      const before = snapshot()
      if (action === 'release') await api.release(preview.token)
      else owner.emit(action)
      expect((await apply(preview)).error).toBeDefined()
      expect((await api.preview({ token: preview.token }))?.error).toBeDefined()
      expect(snapshot()).toEqual(before)
    }
  )

  it('expires previews after twenty minutes without accepting a stale apply', async () => {
    vi.useFakeTimers()
    const preview = await previewInputs([simple])
    const before = snapshot()
    vi.advanceTimersByTime(20 * 60 * 1000)
    expect((await apply(preview)).error).toBeDefined()
    expect(snapshot()).toEqual(before)
  })

  it('invalidates the previous preview when a new native file selection is cancelled', async () => {
    const preview = await previewInputs([simple])
    const before = snapshot()
    expect(await api.preview({})).toBeNull()
    expect((await apply(preview)).error).toBeDefined()
    expect(snapshot()).toEqual(before)
  })

  it('discards previously decoded credentials after a subsequent failed unlock', async () => {
    const preview = await previewWithSecrets([input])
    const before = snapshot()
    expect(
      (
        await api.preview({
          token: preview.token,
          passphrase: 'wrong-passphrase'
        })
      )?.error
    ).toBeDefined()
    expect((await apply(preview)).error).toBeDefined()
    expect(snapshot()).toEqual(before)
  })

  it('cancels file selection and rejects unknown tokens without writes', async () => {
    const before = snapshot()
    expect(await api.preview({})).toBeNull()
    expect(
      (
        await api.apply({
          token: 'unknown',
          entries: [{ index: 0 }],
          acknowledgeWarnings: true
        })
      ).error
    ).toBeDefined()
    expect(snapshot()).toEqual(before)
  })

  it('returns a sanitized error for an unreadable file', async () => {
    const before = snapshot()
    bridge.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: [join(dir, 'missing.json')]
    })
    const preview = await api.preview({})
    expect(preview?.error).toBeDefined()
    expect(JSON.stringify(preview)).not.toContain(dir)
    expect(snapshot()).toEqual(before)
  })

  it.each(['{"connections":', 'this is not a connection file'])(
    'rejects a malformed or unsupported file without making it applicable: %s',
    async (text) => {
      const before = snapshot()
      const preview = await previewText(text)
      expect(preview.error).toBeDefined()
      expect(preview.rows).toEqual([])
      expectSanitized(preview)
      expect((await apply(preview, [{ index: 0 }])).error).toBeDefined()
      expect(snapshot()).toEqual(before)
    }
  )

  it('requires warning acknowledgement and rejects invalid rows in a mixed import before writing', async () => {
    const preview = await previewText(
      'mongodb://reader:uri-secret@db.example.test/shop?tlsCAFile=%2Fcerts%2Fca.pem\nthis is not a mongodb URL',
      'connections.txt'
    )
    const valid = preview.rows.find((row) => row.config && !row.error)!
    const invalid = preview.rows.find((row) => row.error)!
    expect(valid).toBeDefined()
    expect(invalid).toBeDefined()
    expect(valid.warnings.length).toBeGreaterThan(0)
    expect(JSON.stringify(preview)).not.toContain('uri-secret')
    const before = snapshot()
    expect(
      (
        await api.apply({
          token: preview.token,
          entries: [{ index: valid.index }],
          acknowledgeWarnings: false
        })
      ).error
    ).toBeDefined()
    expect(
      (await apply(preview, [{ index: valid.index }, { index: invalid.index }])).error
    ).toBeDefined()
    expect(snapshot()).toEqual(before)
    const result = await apply(preview, [{ index: valid.index }])
    expect(result.error).toBeUndefined()
    expect(result.count).toBe(1)
    expect(JSON.stringify(result)).not.toContain('uri-secret')
  })

  it('exports an encrypted native file through the save dialog, returning only the count', async () => {
    const saved = connectionStore.saveConnection(input)
    const path = join(dir, 'export.amdm.json')
    bridge.showSaveDialog.mockResolvedValueOnce({
      canceled: false,
      filePath: path
    })
    const result = await api.export({
      ids: [saved.id],
      format: 'amdm',
      includeSecrets: true,
      passphrase: 'export-passphrase',
      destination: 'file'
    })
    expect(result).toEqual({ count: 1 })
    expect(bridge.showSaveDialog).toHaveBeenCalledWith(bridge.owner, expect.any(Object))
    expect(bridge.writeText).not.toHaveBeenCalled()
    const text = readFileSync(path, 'utf8')
    for (const field of secretFields) expect(text).not.toContain(input[field])
    const locked = await previewText(text)
    expect(locked.needsPassword).toBe(true)
    const unlocked = await api.preview({
      token: locked.token,
      passphrase: 'export-passphrase'
    })
    expect(unlocked?.rows).toHaveLength(1)
    expectSanitized(unlocked)
  })

  it('writes explicitly requested plaintext credentials only to the main clipboard', async () => {
    const saved = connectionStore.saveConnection({
      ...input,
      ssh: { enabled: false }
    })
    const before = snapshot()
    const result = await api.export({
      ids: [saved.id],
      format: 'urls',
      includeSecrets: true,
      destination: 'clipboard'
    })
    expect(result).toEqual({ count: 1 })
    expect(bridge.writeText).toHaveBeenCalledTimes(1)
    expect(bridge.writeText.mock.calls[0][0]).toContain(input.password)
    expect(bridge.showSaveDialog).not.toHaveBeenCalled()
    expect(snapshot()).toEqual(before)
  })

  it('omits credentials from a redacted clipboard export', async () => {
    const saved = connectionStore.saveConnection(input)
    const result = await api.export({
      ids: [saved.id],
      format: 'urls',
      includeSecrets: false,
      destination: 'clipboard'
    })
    expect(result).toEqual({ count: 1 })
    expect(bridge.writeText).toHaveBeenCalledTimes(1)
    const text = bridge.writeText.mock.calls[0][0] as string
    for (const field of secretFields) expect(text).not.toContain(input[field])
    expectSanitized(result)
  })

  it('cancels export without creating a file or touching the clipboard', async () => {
    const saved = connectionStore.saveConnection(simple)
    const before = snapshot()
    const result = await api.export({
      ids: [saved.id],
      format: 'amdm',
      includeSecrets: false,
      destination: 'file'
    })
    expect(result.cancelled).toBe(true)
    expect(bridge.writeText).not.toHaveBeenCalled()
    expect(snapshot()).toEqual(before)
  })

  it('preflights all export ids before writing any clipboard content', async () => {
    const saved = connectionStore.saveConnection(input)
    const result = await api.export({
      ids: [saved.id, 'missing'],
      format: 'urls',
      includeSecrets: true,
      destination: 'clipboard'
    })
    expect(result.error).toBeDefined()
    expectSanitized(result)
    expect(bridge.writeText).not.toHaveBeenCalled()
    expect(bridge.showSaveDialog).not.toHaveBeenCalled()
  })

  it.each([
    { format: 'amdm', includeSecrets: true, destination: 'file' },
    { format: 'amdm', includeSecrets: false, destination: 'clipboard' },
    { format: 'compass', includeSecrets: false, destination: 'clipboard' }
  ] as const)(
    'rejects unsupported $format/$destination or unencrypted secret exports before opening a dialog',
    async (request) => {
      const saved = connectionStore.saveConnection(input)
      const result = await api.export({ ids: [saved.id], ...request })
      expect(result.error).toBeDefined()
      expectSanitized(result)
      expect(bridge.showSaveDialog).not.toHaveBeenCalled()
      expect(bridge.writeText).not.toHaveBeenCalled()
    }
  )

  it('rejects an export if any stored credential cannot be decrypted', async () => {
    const saved = connectionStore.saveConnection(input)
    vi.spyOn(electron.safeStorage, 'decryptString').mockImplementationOnce(() => {
      throw new Error('key unavailable')
    })
    const result = await api.export({
      ids: [saved.id],
      format: 'urls',
      includeSecrets: true,
      destination: 'clipboard'
    })
    expect(result.error).toBeDefined()
    expectSanitized(result)
    expect(bridge.writeText).not.toHaveBeenCalled()
  })

  it('reports file and clipboard write failures without exposing content', async () => {
    const saved = connectionStore.saveConnection(input)
    const path = join(dir, 'missing-directory', 'export.json')
    bridge.showSaveDialog.mockResolvedValueOnce({
      canceled: false,
      filePath: path
    })
    const fileResult = await api.export({
      ids: [saved.id],
      format: 'amdm',
      includeSecrets: false,
      destination: 'file'
    })
    expect(fileResult.error).toBeDefined()
    expect(existsSync(path)).toBe(false)
    bridge.writeText.mockImplementationOnce(() => {
      throw new Error(`clipboard failed: ${input.password}`)
    })
    const clipboardResult = await api.export({
      ids: [saved.id],
      format: 'urls',
      includeSecrets: true,
      destination: 'clipboard'
    })
    expect(clipboardResult.error).toBeDefined()
    expectSanitized(fileResult)
    expectSanitized(clipboardResult)
  })
})
