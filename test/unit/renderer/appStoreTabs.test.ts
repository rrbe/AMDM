import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTab } from '../../../src/renderer/src/lib/tabs'
import { useAppStore } from '../../../src/renderer/src/store/useAppStore'
import type { ShellResult } from '../../../src/shared/types'

describe('connection-bound tabs', () => {
  beforeEach(() => {
    useAppStore.setState({
      tabs: [createTab('c1-tab', { connectionId: 'c1' })],
      activeTabId: 'c1-tab',
      activeConnectionId: 'c1'
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('switches or creates tabs with their bound connection', () => {
    useAppStore.getState().setActiveConnection('c2')
    const c2Tab = useAppStore.getState().tabs.find((tab) => tab.connectionId === 'c2')

    expect(c2Tab).toBeDefined()
    expect(useAppStore.getState().activeTabId).toBe(c2Tab?.id)

    useAppStore.getState().setActiveTab('c1-tab')
    expect(useAppStore.getState().activeConnectionId).toBe('c1')

    useAppStore.getState().setActiveConnection('c2')
    expect(useAppStore.getState().tabs).toHaveLength(2)
    expect(useAppStore.getState().activeTabId).toBe(c2Tab?.id)
  })

  it('shows running, keeps real failures red, and clears a stopped run', async () => {
    let finish!: (result: ShellResult) => void
    const execute = vi.fn(
      () =>
        new Promise<ShellResult>((resolve) => {
          finish = resolve
        })
    )
    vi.stubGlobal('window', {
      api: {
        shell: { execute },
        history: { list: vi.fn().mockResolvedValue([]) }
      }
    })
    useAppStore.setState({
      tabs: [
        createTab('c1-tab', {
          connectionId: 'c1',
          activeDatabase: 'test',
          code: 'db.items.find({})'
        })
      ]
    })

    const failedRun = useAppStore.getState().runShell()
    expect(useAppStore.getState().tabs[0]).toMatchObject({ running: true, runFailed: false })
    finish({ kind: 'error', errorName: 'MongoServerError', error: 'boom' })
    await failedRun
    expect(useAppStore.getState().tabs[0]).toMatchObject({ running: false, runFailed: true })

    execute.mockResolvedValueOnce({ kind: 'error', errorName: 'Aborted', error: '执行已停止' })
    await useAppStore.getState().runShell()
    expect(useAppStore.getState().tabs[0]).toMatchObject({ running: false, runFailed: false })
  })
})
