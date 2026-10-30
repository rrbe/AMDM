import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../src/shared/ipc'

const fake = vi.hoisted(() => ({
  app: undefined as unknown as EventEmitter & {
    quit: ReturnType<typeof vi.fn>
    exit: ReturnType<typeof vi.fn>
  },
  windows: [] as TestWindow[],
  handlers: new Map<string, (...args: unknown[]) => void>(),
  api: undefined as Api | undefined,
  sender: undefined as unknown,
  confirm: vi.fn(),
  settings: { language: 'system', confirmBeforeQuit: true },
  shutdown: vi.fn(),
  hasActiveSessions: vi.fn(),
  dispose: vi.fn(),
  showError: vi.fn()
}))

class TestWindow extends EventEmitter {
  webContents = {}
  destroyed = false
  setEnabled = vi.fn()
  setProgressBar = vi.fn()
  isDestroyed(): boolean {
    return this.destroyed
  }
  close(): void {
    const event = { preventDefault: vi.fn() }
    this.emit('close', event)
    if (event.preventDefault.mock.calls.length) return
    this.destroyed = true
    this.emit('closed')
  }
}

vi.mock('electron', () => ({
  app: {
    on: (...args: Parameters<EventEmitter['on']>) => fake.app.on(...args),
    quit: () => fake.app.quit(),
    exit: (code: number) => fake.app.exit(code),
    getPreferredSystemLanguages: () => ['zh-CN']
  },
  BrowserWindow: {
    getAllWindows: () => fake.windows.filter((win) => !win.destroyed),
    fromWebContents: (sender: unknown) => fake.windows.find((win) => win.webContents === sender)
  },
  dialog: { showMessageBox: fake.confirm, showErrorBox: fake.showError },
  ipcMain: {
    on: (channel: string, handler: (...args: unknown[]) => void) =>
      fake.handlers.set(channel, handler)
  },
  ipcRenderer: {
    send: (channel: string, ...args: unknown[]) =>
      fake.handlers.get(channel)!({ sender: fake.sender }, ...args)
  },
  contextBridge: {
    exposeInMainWorld: (_name: string, api: Api) => {
      fake.api = api
    }
  }
}))
vi.mock('../../src/main/mongo/desktopSession', () => ({
  sessionManager: { hasActiveSessions: fake.hasActiveSessions, shutdown: fake.shutdown }
}))
vi.mock('../../src/main/store/settingsStore', () => ({
  settingsStore: { get: () => fake.settings }
}))
vi.mock('../../src/main/workers/serializerPool', () => ({
  serializerPool: { dispose: fake.dispose }
}))

describe('desktop close and quit through the preload bridge', () => {
  let main: TestWindow, settings: TestWindow

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    fake.handlers.clear()
    fake.settings.confirmBeforeQuit = true
    fake.app = Object.assign(new EventEmitter(), { quit: vi.fn(), exit: vi.fn() })
    fake.app.quit.mockImplementation(() => {
      const event = { preventDefault: vi.fn() }
      fake.app.emit('before-quit', event)
      if (!event.preventDefault.mock.calls.length) fake.windows.forEach((win) => win.close())
    })
    main = new TestWindow()
    settings = new TestWindow()
    fake.windows = [main, settings]
    fake.sender = main.webContents
    fake.confirm.mockResolvedValue({ response: 0 })
    fake.hasActiveSessions.mockReturnValue(false)
    fake.shutdown.mockResolvedValue(undefined)
    const lifecycle = await import('../../src/main/appLifecycle')
    lifecycle.registerAppLifecycle()
    lifecycle.trackMainWindow(main as never)
    await import('../../src/preload/index')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('forces process exit when resource cleanup stalls beyond its deadline', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    fake.shutdown.mockImplementation(() => new Promise<void>(() => {}))
    main.close()
    await vi.advanceTimersByTimeAsync(0)
    expect(fake.shutdown).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(9_999)
    expect(fake.app.exit).not.toHaveBeenCalled()
    main.close()
    fake.app.quit()
    await vi.advanceTimersByTimeAsync(1)
    expect(fake.app.exit).toHaveBeenCalledExactlyOnceWith(1)
    expect(fake.shutdown).toHaveBeenCalledOnce()
    expect(main.destroyed).toBe(false)
  })

  it('starts the cleanup deadline after confirmation and clears it after successful cleanup', async () => {
    vi.useFakeTimers()
    fake.hasActiveSessions.mockReturnValue(true)
    let confirm!: (result: { response: number }) => void
    fake.confirm.mockImplementation(() => new Promise((resolve) => { confirm = resolve }))
    main.close()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(fake.shutdown).not.toHaveBeenCalled()
    expect(fake.app.exit).not.toHaveBeenCalled()
    confirm({ response: 1 })
    await vi.advanceTimersByTimeAsync(0)
    expect(main.destroyed).toBe(true)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(fake.app.exit).not.toHaveBeenCalled()
  })

  it('preserves query state and connections when closing the workspace is cancelled', async () => {
    fake.api!.app.workspaceChanged(true)
    main.close()
    await vi.waitFor(() => expect(fake.confirm).toHaveBeenCalledOnce())
    expect(fake.confirm).toHaveBeenCalledWith(
      main,
      expect.objectContaining({
        message: '关闭 AMDM？',
        defaultId: 0,
        cancelId: 0
      })
    )
    expect(main.destroyed).toBe(false)
    expect(fake.shutdown).not.toHaveBeenCalled()
    expect(fake.app.quit).not.toHaveBeenCalled()
  })

  it('waits for disconnects before destroying the workspace and settings window', async () => {
    let finish!: () => void
    fake.hasActiveSessions.mockReturnValue(true)
    fake.confirm.mockResolvedValue({ response: 1 })
    fake.shutdown.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    main.close()
    main.close()
    await vi.waitFor(() => expect(fake.shutdown).toHaveBeenCalledOnce())
    expect(main.destroyed).toBe(false)
    expect(settings.destroyed).toBe(false)
    expect(main.setEnabled).toHaveBeenCalledWith(false)
    finish()
    await vi.waitFor(() => expect(main.destroyed).toBe(true))
    expect(settings.destroyed).toBe(true)
    expect(fake.dispose).toHaveBeenCalledOnce()
    expect(fake.confirm).toHaveBeenCalledOnce()
    expect(fake.app.quit).toHaveBeenCalledOnce()
  })

  it('routes application quit through the same cancellable confirmation', async () => {
    fake.api!.app.workspaceChanged(true)
    fake.app.quit()
    await vi.waitFor(() => expect(fake.confirm).toHaveBeenCalledOnce())
    expect(main.destroyed).toBe(false)
    expect(fake.shutdown).not.toHaveBeenCalled()
  })

  it.each(['close', 'quit'])('skips confirmation for %s when disabled and still awaits cleanup', async (action) => {
    fake.settings.confirmBeforeQuit = false
    fake.hasActiveSessions.mockReturnValue(true)
    fake.api!.app.workspaceChanged(true)
    let finish!: () => void
    fake.shutdown.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve }))
    if (action === 'close') main.close()
    else fake.app.quit()
    await vi.waitFor(() => expect(fake.shutdown).toHaveBeenCalledOnce())
    expect(fake.confirm).not.toHaveBeenCalled()
    expect(main.destroyed).toBe(false)
    finish()
    await vi.waitFor(() => expect(main.destroyed).toBe(true))
    expect(fake.dispose).toHaveBeenCalledOnce()
  })

  it('closes settings independently and ignores its workspace reports', async () => {
    fake.sender = settings.webContents
    fake.api!.app.workspaceChanged(true)
    settings.close()
    expect(main.destroyed).toBe(false)
    expect(fake.confirm).not.toHaveBeenCalled()
    main.close()
    await vi.waitFor(() => expect(main.destroyed).toBe(true))
    expect(fake.confirm).not.toHaveBeenCalled()
    expect(fake.shutdown).toHaveBeenCalledOnce()
  })

  it('does not warn after the workspace becomes empty', async () => {
    fake.api!.app.workspaceChanged(true)
    fake.api!.app.workspaceChanged(false)
    main.close()
    await vi.waitFor(() => expect(main.destroyed).toBe(true))
    expect(fake.confirm).not.toHaveBeenCalled()
  })
})
