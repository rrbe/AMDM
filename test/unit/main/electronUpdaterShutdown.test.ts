import { beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => ({
  listeners: new Map<string, (info: { version: string }) => void>(),
  prepare: vi.fn(),
  install: vi.fn()
}))
vi.mock('electron', () => ({ app: { isPackaged: true } }))
vi.mock('electron-updater', () => ({
  default: {
    autoUpdater: {
      on: (event: string, listener: (info: { version: string }) => void) =>
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
    vi.clearAllMocks()
    fake.listeners.clear()
  })

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
  })
})
