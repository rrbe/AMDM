import { afterEach, describe, expect, it, vi } from 'vitest'
import { webApi } from '../../../src/renderer/src/webApi'

afterEach(() => vi.unstubAllGlobals())

describe('Web API navigation', () => {
  it('opens Settings in the current history without adding duplicate entries', async () => {
    const location = { hash: '' }
    const history = {
      state: null as Record<string, unknown> | null,
      pushState: vi.fn((state: Record<string, unknown>) => {
        history.state = state
        location.hash = '#settings'
      })
    }
    const dispatchEvent = vi.fn()
    vi.stubGlobal('window', { location, history, dispatchEvent })

    await webApi.app.openSettings()
    await webApi.app.openSettings()

    expect(history.pushState).toHaveBeenCalledOnce()
    expect(history.state).toMatchObject({ amdmRoute: 'settings' })
    expect(dispatchEvent).toHaveBeenCalledOnce()
    expect(dispatchEvent.mock.calls[0][0]).toMatchObject({ type: 'popstate' })
  })
})
