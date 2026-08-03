import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@renderer/store/useAppStore'

describe('manual updates', () => {
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
})
