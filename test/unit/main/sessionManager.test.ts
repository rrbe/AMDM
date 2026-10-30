import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionConfig } from '../../../src/shared/types'

const fake = vi.hoisted(() => {
  let rejectConnect: (error: Error) => void = () => {}
  let resolveConnect: () => void = () => {}
  return {
    clients: [] as Array<{
      close: ReturnType<typeof vi.fn>
      emit: (event: string, payload: unknown) => void
    }>,
    command: vi.fn(),
    connect: vi.fn(
      () =>
        new Promise<void>((resolve, reject) => {
          resolveConnect = resolve
          rejectConnect = reject
        })
    ),
    cancelConnect: (): void => rejectConnect(new Error('client was closed')),
    failConnect: (error: Error): void => rejectConnect(error),
    finishConnect: (): void => resolveConnect()
  }
})

vi.mock('mongodb', () => ({
  MongoClient: class {
    close = vi.fn(async () => fake.cancelConnect())
    private listeners = new Map<string, Set<(payload: unknown) => void>>()

    constructor() {
      fake.clients.push(this)
    }

    db(): { command: typeof fake.command } {
      return { command: fake.command }
    }

    connect(): Promise<void> {
      return fake.connect()
    }

    on(event: string, listener: (payload: unknown) => void): this {
      const listeners = this.listeners.get(event) ?? new Set()
      listeners.add(listener)
      this.listeners.set(event, listeners)
      return this
    }

    removeListener(event: string, listener: (payload: unknown) => void): this {
      this.listeners.get(event)?.delete(listener)
      return this
    }

    emit(event: string, payload: unknown): void {
      for (const listener of this.listeners.get(event) ?? []) listener(payload)
    }
  }
}))

const config: ConnectionConfig = {
  id: 'c1',
  name: 'slow',
  useSrv: false,
  host: 'unreachable',
  port: 27017,
  auth: { type: 'none' },
  ssh: { enabled: false },
  tls: { enabled: false },
  createdAt: 0,
  updatedAt: 0
}

vi.mock('../../../src/main/store/connectionStore', () => ({
  connectionStore: {
    getDecrypted: vi.fn(() => ({ config })),
    recordSshHostKey: vi.fn(),
    recordSshJumpHostKey: vi.fn()
  }
}))

import { connectionStore } from '../../../src/main/store/connectionStore'
import { SessionManager } from '../../../src/main/mongo/sessionManager'
import { shellResults } from '../../../src/main/mongo/shellResults'

describe('SessionManager', () => {
  beforeEach(() => {
    fake.clients.length = 0
    fake.connect.mockClear()
    fake.command.mockReset()
  })

  it('disconnects an in-flight connection attempt without publishing an error', async () => {
    const manager = new SessionManager(connectionStore)
    const connecting = manager.connect('c1')
    await vi.waitFor(() => expect(fake.clients).toHaveLength(1))

    expect(manager.getStatus('c1').state).toBe('connecting')
    await manager.disconnect('c1')

    expect(fake.clients[0].close).toHaveBeenCalled()
    await expect(connecting).resolves.toEqual({
      id: 'c1',
      state: 'disconnected'
    })
    expect(manager.getStatus('c1').state).toBe('disconnected')
  })

  it('shuts down live and pending clients, and prevents new connections', async () => {
    const manager = new SessionManager(connectionStore)
    expect(manager.hasActiveSessions()).toBe(false)
    const connected = manager.connect('c1')
    await vi.waitFor(() => expect(fake.clients).toHaveLength(1))
    fake.finishConnect()
    await connected
    const pending = manager.connect('c2')
    await vi.waitFor(() => expect(fake.clients).toHaveLength(2))
    expect(manager.hasActiveSessions()).toBe(true)

    await manager.shutdown()
    await expect(pending).resolves.toMatchObject({ state: 'disconnected' })
    expect(fake.clients.every((client) => client.close.mock.calls.length > 0)).toBe(true)
    expect(manager.hasActiveSessions()).toBe(false)
    await expect(manager.connect('c3')).resolves.toMatchObject({ state: 'disconnected' })
    expect(fake.clients).toHaveLength(2)
    expect(() => manager.getClient('c1')).toThrow('closing')
  })

  it('does not create a client when shutdown wins the initial disconnect await', async () => {
    const manager = new SessionManager(connectionStore)
    const connecting = manager.connect('c1')
    await manager.shutdown()
    await expect(connecting).resolves.toMatchObject({ state: 'disconnected' })
    expect(fake.clients).toHaveLength(0)
  })

  it.each(['closeAll', 'shutdown'] as const)(
    '%s waits for an already-started disconnect to finish closing its client',
    async (method) => {
      const manager = new SessionManager(connectionStore)
      const connecting = manager.connect('c1')
      await vi.waitFor(() => expect(fake.clients).toHaveLength(1))
      fake.finishConnect()
      await connecting
      let finish!: () => void
      fake.clients[0].close.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve }))
      const disconnecting = manager.disconnect('c1')
      expect(manager.disconnect('c1')).toBe(disconnecting)
      await vi.waitFor(() => expect(fake.clients[0].close).toHaveBeenCalledOnce())
      expect(manager.getStatus('c1').state).toBe('disconnected')
      expect(manager.hasActiveSessions()).toBe(true)

      let closed = false
      const closing = manager[method]().then(() => { closed = true })
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(closed).toBe(false)
      finish()
      await Promise.all([disconnecting, closing])
      expect(closed).toBe(true)
      expect(manager.hasActiveSessions()).toBe(false)
    }
  )

  it('waits for other disconnects even when result cleanup fails', async () => {
    const manager = new SessionManager(connectionStore)
    for (const id of ['c1', 'c2']) {
      const connecting = manager.connect(id)
      await vi.waitFor(() => expect(fake.clients).toHaveLength(id === 'c1' ? 1 : 2))
      fake.finishConnect()
      await connecting
    }
    let finish!: () => void
    fake.clients[1].close.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve }))
    const release = vi.spyOn(shellResults, 'closeConnection').mockRejectedValueOnce(new Error('cache cleanup failed'))
    try {
      let failed = false
      const closing = manager.shutdown().catch((error: unknown) => { failed = true; return error })
      await vi.waitFor(() => expect(fake.clients[1].close).toHaveBeenCalledOnce())
      expect(failed).toBe(false)
      finish()
      expect(await closing).toEqual(new Error('cache cleanup failed'))
      expect(manager.hasActiveSessions()).toBe(false)
    } finally {
      release.mockRestore()
    }
  })

  it('still closes its client if result cleanup fails', async () => {
    const manager = new SessionManager(connectionStore)
    const connecting = manager.connect('c1')
    await vi.waitFor(() => expect(fake.clients).toHaveLength(1))
    fake.finishConnect()
    await connecting
    const release = vi.spyOn(shellResults, 'closeConnection').mockRejectedValueOnce(new Error('cache cleanup failed'))
    try {
      await expect(manager.shutdown()).rejects.toThrow('cache cleanup failed')
      expect(fake.clients[0].close).toHaveBeenCalledOnce()
    } finally {
      release.mockRestore()
    }
  })

  it('returns a stable timeout kind for a failed connection attempt', async () => {
    const manager = new SessionManager(connectionStore)
    const connecting = manager.connect('c1')
    await vi.waitFor(() => expect(fake.clients).toHaveLength(1))

    fake.failConnect(new Error('Server selection timed out after 30000 ms'))

    await expect(connecting).resolves.toMatchObject({
      id: 'c1',
      state: 'error',
      failureKind: 'timeout'
    })
  })

  it('keeps a successful connection test successful when permission inspection fails, and closes the client', async () => {
    fake.command.mockImplementation(async (command: Record<string, unknown>) => {
      if (command.connectionStatus) throw new Error('command not supported')
      return {}
    })
    const testing = new SessionManager(connectionStore).test({ config })
    await vi.waitFor(() => expect(fake.clients).toHaveLength(1))
    fake.finishConnect()
    await expect(testing).resolves.toMatchObject({ ok: true, authorizationError: 'command not supported' })
    expect(fake.command).toHaveBeenCalledWith(
      { connectionStatus: 1, showPrivileges: true }, { timeoutMS: 5_000 }
    )
    expect(fake.clients[0].close).toHaveBeenCalledOnce()
  })

  it('publishes driver topology loss and recovery without discarding the client', async () => {
    const manager = new SessionManager(connectionStore)
    const statuses: Array<{ state: string; error?: string }> = []
    manager.onStatusChanged((status) => statuses.push(status))

    const connecting = manager.connect('c1')
    await vi.waitFor(() => expect(fake.clients).toHaveLength(1))
    fake.finishConnect()
    await connecting

    fake.clients[0].emit('topologyDescriptionChanged', {
      newDescription: {
        hasKnownServers: false,
        error: new Error('socket closed'),
        type: 'Unknown'
      }
    })
    expect(manager.getStatus('c1')).toMatchObject({ state: 'error', error: 'socket closed' })
    expect(statuses.at(-1)).toMatchObject({ state: 'error', error: 'socket closed' })

    fake.clients[0].emit('topologyDescriptionChanged', {
      newDescription: {
        hasKnownServers: true,
        error: null,
        type: 'Single'
      }
    })
    expect(manager.getStatus('c1').state).toBe('connected')
    expect(statuses.at(-1)).toMatchObject({ state: 'connected' })
  })
})
