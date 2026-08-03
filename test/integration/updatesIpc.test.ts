import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../src/shared/ipc'
import { IPC } from '../../src/shared/ipc'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  exposedApi: undefined as Api | undefined,
  checkForUpdates: vi.fn<() => boolean>()
}))

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: vi.fn((_name: string, api: Api) => {
      mocks.exposedApi = api
    })
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler)
    })
  },
  ipcRenderer: {
    invoke: vi.fn((channel: string, ...args: unknown[]) => {
      const handler = mocks.handlers.get(channel)
      if (!handler) throw new Error(`No IPC handler for ${channel}`)
      return Promise.resolve().then(() => handler({}, ...args))
    })
  }
}))

vi.mock('../../src/main/sparkle', () => ({
  checkSparkleForUpdates: mocks.checkForUpdates
}))

import '../../src/preload/index'
import { registerUpdatesIpc } from '../../src/main/ipc/registerUpdatesIpc'

describe('updates IPC', () => {
  beforeEach(() => {
    mocks.handlers.clear()
    mocks.checkForUpdates.mockReset()
    registerUpdatesIpc()
  })

  it('connects the preload API to the registered main handler', async () => {
    mocks.checkForUpdates.mockReturnValue(true)

    await expect(mocks.exposedApi?.updates.checkForUpdates()).resolves.toBe(true)
    expect(mocks.handlers.has(IPC.updatesCheck)).toBe(true)
  })

  it('returns false when Sparkle is unavailable', async () => {
    mocks.checkForUpdates.mockReturnValue(false)

    await expect(mocks.exposedApi?.updates.checkForUpdates()).resolves.toBe(false)
  })

  it('propagates updater errors across the IPC seam', async () => {
    mocks.checkForUpdates.mockImplementation(() => {
      throw new Error('updater failed')
    })

    await expect(mocks.exposedApi?.updates.checkForUpdates()).rejects.toThrow('updater failed')
  })
})
