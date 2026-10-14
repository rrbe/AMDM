import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@renderer/store/useAppStore'

describe('manual updates', () => {
  const emptyState = {
    available: true,
    automaticallyChecksForUpdates: true,
    phase: 'idle' as const,
    availableVersion: null,
    downloadProgress: null
  }

  afterEach(() => {
    useAppStore.setState({ updateState: emptyState, notifications: [] })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('delegates the manual check to the updater bridge', async () => {
    const checkForUpdates = vi.fn().mockResolvedValue(true)
    vi.stubGlobal('window', { api: { updates: { checkForUpdates } } })

    await expect(useAppStore.getState().checkForUpdates()).resolves.toBe(true)
    expect(checkForUpdates).toHaveBeenCalledOnce()
  })

  it('returns false when the updater is unavailable', async () => {
    vi.stubGlobal('window', {
      api: { updates: { checkForUpdates: vi.fn().mockResolvedValue(false) } }
    })

    await expect(useAppStore.getState().checkForUpdates()).resolves.toBe(false)
  })

  it('updates the automatic-check preference from the updater response', async () => {
    const disabled = { ...emptyState, automaticallyChecksForUpdates: false }
    const setAutomaticChecks = vi.fn().mockResolvedValue(disabled)
    vi.stubGlobal('window', { api: { updates: { setAutomaticChecks } } })

    await useAppStore.getState().setAutomaticUpdateChecks(false)

    expect(setAutomaticChecks).toHaveBeenCalledWith(false)
    expect(useAppStore.getState().updateState).toEqual(disabled)
  })

  it('keeps the updater-owned state while opening an available update', async () => {
    const showAvailableUpdate = vi.fn().mockResolvedValue(true)
    vi.stubGlobal('window', { api: { updates: { showAvailableUpdate } } })
    useAppStore.setState({
      updateState: { ...emptyState, phase: 'available', availableVersion: '26.8.11' }
    })

    await expect(useAppStore.getState().showAvailableUpdate()).resolves.toBe(true)

    expect(useAppStore.getState().updateState.availableVersion).toBe('26.8.11')
    expect(showAvailableUpdate).toHaveBeenCalledOnce()
  })

  it('cancels an active update download', async () => {
    const cancelDownload = vi.fn().mockResolvedValue(true)
    vi.stubGlobal('window', { api: { updates: { cancelDownload } } })

    await expect(useAppStore.getState().cancelUpdateDownload()).resolves.toBe(true)
    expect(cancelDownload).toHaveBeenCalledOnce()
  })
})
