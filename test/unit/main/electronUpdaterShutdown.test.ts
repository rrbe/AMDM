import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => ({
  listeners: new Map<string, (info: { version: string } | Error) => void>(),
  prepare: vi.fn(),
  install: vi.fn(),
  quit: vi.fn()
}))
vi.mock('electron', () => ({ app: { isPackaged: true, quit: fake.quit } }))
vi.mock('electron-updater', () => ({
  default: {
    autoUpdater: {
      on: (event: string, listener: (info: { version: string } | Error) => void) =>
        fake.listeners.set(event, listener),
      quitAndInstall: fake.install
    }
  }
}))
vi.mock('../../../src/main/electronUpdaterCore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/main/electronUpdaterCore')>()),
  canUseElectronUpdater: () => true
}))
vi.mock('../../../src/main/appLifecycle', () => ({ prepareAppQuit: fake.prepare }))
vi.mock('../../../src/main/store/settingsStore', () => ({
  settingsStore: { get: () => ({ automaticUpdateChecks: false }) }
}))

describe('update installation shutdown', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.resetAllMocks()
    fake.listeners.clear()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => vi.restoreAllMocks())

  async function downloadedUpdate() {
    const updater = await import('../../../src/main/electronUpdater')
    updater.startElectronUpdater()
    fake.listeners.get('update-downloaded')!({ version: '26.10.5' })
    return updater
  }

  it('keeps a downloaded update pending when the user cancels closing', async () => {
    const updater = await downloadedUpdate()
    fake.prepare.mockResolvedValue(false)
    expect(await updater.showAvailableElectronUpdate()).toBe(false)
    expect(fake.install).not.toHaveBeenCalled()
    expect(updater.getElectronUpdateState().phase).toBe('downloaded')
  })

  it('waits for confirmation and resource cleanup before starting the installer', async () => {
    const updater = await downloadedUpdate()
    let finish!: (confirmed: boolean) => void
    fake.prepare.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve
        })
    )
    const installing = updater.showAvailableElectronUpdate()
    expect(fake.install).not.toHaveBeenCalled()
    finish(true)
    expect(await installing).toBe(true)
    expect(fake.install).toHaveBeenCalledWith(false, true)
    expect(fake.quit).not.toHaveBeenCalled()
  })

  it('finishes quitting when the installer emits an error instead of throwing', async () => {
    const updater = await downloadedUpdate()
    fake.prepare.mockResolvedValue(true)
    fake.install.mockImplementation(() => {
      fake.listeners.get('error')!(new Error('AppImage directory is not writable'))
    })
    expect(await updater.showAvailableElectronUpdate()).toBe(false)
    const { default: { autoUpdater } } = await import('electron-updater')
    expect(autoUpdater.autoInstallOnAppQuit).toBe(false)
    expect(fake.quit).toHaveBeenCalledOnce()
  })

  it('finishes quitting when installer startup fails asynchronously', async () => {
    const updater = await downloadedUpdate()
    fake.prepare.mockResolvedValue(true)
    expect(await updater.showAvailableElectronUpdate()).toBe(true)
    fake.listeners.get('error')!(new Error('Failed to spawn installer'))
    expect(fake.quit).toHaveBeenCalledOnce()
    const { default: { autoUpdater } } = await import('electron-updater')
    expect(autoUpdater.autoInstallOnAppQuit).toBe(false)
  })

  it('finishes quitting and reports an exception thrown by the installer', async () => {
    const updater = await downloadedUpdate()
    fake.prepare.mockResolvedValue(true)
    fake.install.mockImplementation(() => { throw new Error('Installer unavailable') })
    await expect(updater.showAvailableElectronUpdate()).rejects.toThrow('Installer unavailable')
    expect(fake.quit).toHaveBeenCalledOnce()
  })

  it('does not quit on update errors before shutdown is committed', async () => {
    await downloadedUpdate()
    fake.listeners.get('error')!(new Error('Download failed'))
    expect(fake.quit).not.toHaveBeenCalled()
  })
})
