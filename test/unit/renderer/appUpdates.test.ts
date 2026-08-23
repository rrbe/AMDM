import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@renderer/store/useAppStore'

describe('manual updates', () => {
  const emptyState = {
    available: true,
    automaticallyChecksForUpdates: true,
    availableVersion: null
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

  it('hides the reminder immediately when the user opens the available update', async () => {
    const showAvailableUpdate = vi.fn().mockResolvedValue(true)
    vi.stubGlobal('window', { api: { updates: { showAvailableUpdate } } })
    useAppStore.setState({ updateState: { ...emptyState, availableVersion: '26.8.11' } })

    await expect(useAppStore.getState().showAvailableUpdate()).resolves.toBe(true)

    expect(useAppStore.getState().updateState.availableVersion).toBeNull()
    expect(showAvailableUpdate).toHaveBeenCalledOnce()
  })
})
