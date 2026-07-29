import { describe, expect, it, vi } from 'vitest'
import type { ConnectionConfig } from '../../../src/shared/types'

const fake = vi.hoisted(() => {
  let rejectConnect: (error: Error) => void = () => {}
  return {
    clients: [] as Array<{ close: ReturnType<typeof vi.fn> }>,
    connect: vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectConnect = reject
        })
    ),
    cancelConnect: (): void => rejectConnect(new Error('client was closed'))
  }
})

vi.mock('mongodb', () => ({
  MongoClient: class {
    close = vi.fn(async () => fake.cancelConnect())

    constructor() {
      fake.clients.push(this)
    }

    connect(): Promise<void> {
      return fake.connect()
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
})
