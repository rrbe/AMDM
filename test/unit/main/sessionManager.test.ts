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

import { SessionManager } from '../../../src/main/mongo/sessionManager'

describe('SessionManager', () => {
  beforeEach(() => {
    fake.clients.length = 0
    fake.connect.mockClear()
  })

  it('disconnects an in-flight connection attempt without publishing an error', async () => {
    const manager = new SessionManager()
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

  it('returns a stable timeout kind for a failed connection attempt', async () => {
    const manager = new SessionManager()
    const connecting = manager.connect('c1')
    await vi.waitFor(() => expect(fake.clients).toHaveLength(1))

    fake.failConnect(new Error('Server selection timed out after 30000 ms'))

    await expect(connecting).resolves.toMatchObject({
      id: 'c1',
      state: 'error',
      failureKind: 'timeout'
    })
  })

  it('publishes driver topology loss and recovery without discarding the client', async () => {
    const manager = new SessionManager()
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
