import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../src/shared/ipc'
import { IPC } from '../../src/shared/ipc'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  listeners: new Map<string, (...args: unknown[]) => void>(),
  exposedApi: undefined as Api | undefined,
  checkForUpdates: vi.fn<() => boolean>(),
  getState: vi.fn(),
  setAutomaticChecks: vi.fn(),
  showAvailableUpdate: vi.fn<() => boolean>(),
  cancelDownload: vi.fn<() => boolean>(),
  subscribe: vi.fn(),
  send: vi.fn()
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
    }),
    on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
      mocks.listeners.set(channel, listener)
    }),
    removeListener: vi.fn((channel: string) => {
      mocks.listeners.delete(channel)
    })
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => [
      {
        isDestroyed: () => false,
        webContents: { isDestroyed: () => false, send: mocks.send }
      }
    ])
  }
}))

vi.mock('../../src/main/updater', () => ({
  checkForUpdates: mocks.checkForUpdates,
  getUpdateState: mocks.getState,
  setAutomaticUpdateChecks: mocks.setAutomaticChecks,
  showAvailableUpdate: mocks.showAvailableUpdate,
  cancelUpdateDownload: mocks.cancelDownload,
  onUpdateStateChanged: mocks.subscribe
}))

import '../../src/preload/index'
import { registerUpdatesIpc } from '../../src/main/ipc/registerUpdatesIpc'

describe('updates IPC', () => {
  beforeEach(() => {
    mocks.handlers.clear()
    mocks.listeners.clear()
    mocks.checkForUpdates.mockReset()
    mocks.getState.mockReset()
    mocks.setAutomaticChecks.mockReset()
    mocks.showAvailableUpdate.mockReset()
    mocks.cancelDownload.mockReset()
    mocks.subscribe.mockReset()
    mocks.send.mockReset()
    registerUpdatesIpc()
  })

  it('gets and changes the automatic-check state through the typed bridge', async () => {
    const enabled = {
      available: true,
      automaticallyChecksForUpdates: true,
      phase: 'idle' as const,
      availableVersion: null,
      downloadProgress: null
    }
    mocks.getState.mockReturnValue(enabled)
    mocks.setAutomaticChecks.mockReturnValue({ ...enabled, automaticallyChecksForUpdates: false })

    await expect(mocks.exposedApi?.updates.getState()).resolves.toEqual(enabled)
    await expect(mocks.exposedApi?.updates.setAutomaticChecks(false)).resolves.toEqual({
      ...enabled,
      automaticallyChecksForUpdates: false
    })
    expect(mocks.setAutomaticChecks).toHaveBeenCalledWith(false)
  })

  it('acknowledges the visible reminder before showing Sparkle', async () => {
    mocks.showAvailableUpdate.mockReturnValue(true)
    await expect(mocks.exposedApi?.updates.showAvailableUpdate()).resolves.toBe(true)
    expect(mocks.showAvailableUpdate).toHaveBeenCalledOnce()
  })

  it('broadcasts scheduled update state to renderer windows', () => {
    const state = {
      available: true,
      automaticallyChecksForUpdates: true,
      phase: 'available' as const,
      availableVersion: '26.8.11',
      downloadProgress: null
    }
    const listener = mocks.subscribe.mock.calls[0]?.[0]
    listener(state)
    expect(mocks.send).toHaveBeenCalledWith(IPC.updatesStateChanged, state)
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

  it('cancels an active download through the typed bridge', async () => {
    mocks.cancelDownload.mockReturnValue(true)
    await expect(mocks.exposedApi?.updates.cancelDownload()).resolves.toBe(true)
    expect(mocks.cancelDownload).toHaveBeenCalledOnce()
  })
})
