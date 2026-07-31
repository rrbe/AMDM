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

  it('loads a saved query into its bound connection without running it', () => {
    const execute = vi.fn()
    vi.stubGlobal('window', { api: { shell: { execute } } })
    useAppStore.setState({
      tabs: [
        createTab('c1-tab', {
          connectionId: 'c1',
          code: 'db.current.find({})',
          pristine: false
        }),
        createTab('c2-tab', { connectionId: 'c2' })
      ],
      activeTabId: 'c1-tab',
      activeConnectionId: 'c1'
    })

    useAppStore.getState().applyQuery('db.saved.find({})', 'saved', 'c2')

    expect(useAppStore.getState()).toMatchObject({
      activeTabId: 'c2-tab',
      activeConnectionId: 'c2'
    })
    expect(useAppStore.getState().tabs.find((tab) => tab.id === 'c2-tab')).toMatchObject({
      code: 'db.saved.find({})',
      activeDatabase: 'saved',
      connectionId: 'c2'
    })
    expect(execute).not.toHaveBeenCalled()

    useAppStore.getState().applyQuery('db.saved.find({})', 'saved', 'c2')
    expect(useAppStore.getState().tabs).toHaveLength(2)
  })

  it('shares concurrent connection attempts', async () => {
    let finish!: (status: { id: string; state: 'connected' }) => void
    const connect = vi.fn(
      () =>
        new Promise<{ id: string; state: 'connected' }>((resolve) => {
          finish = resolve
        })
    )
    vi.stubGlobal('window', {
      api: {
        session: { connect },
        catalog: { databases: vi.fn().mockResolvedValue([]) }
      }
    })

    const first = useAppStore.getState().connect('c2')
    const second = useAppStore.getState().connect('c2')
    expect(connect).toHaveBeenCalledOnce()

    finish({ id: 'c2', state: 'connected' })
    await Promise.all([first, second])
    expect(useAppStore.getState().statuses.c2?.state).toBe('connected')
  })

  it('starts a fresh connection attempt after cancelling the previous one', async () => {
    const finishes: ((status: { id: string; state: 'connected' }) => void)[] = []
    const connect = vi.fn(
      () =>
        new Promise<{ id: string; state: 'connected' }>((resolve) => {
          finishes.push(resolve)
        })
    )
    vi.stubGlobal('window', {
      api: {
        session: { connect, disconnect: vi.fn().mockResolvedValue(undefined) },
        catalog: { databases: vi.fn().mockResolvedValue([]) }
      }
    })

    const first = useAppStore.getState().connect('c2')
    const disconnecting = useAppStore.getState().disconnect('c2')
    const retry = useAppStore.getState().connect('c2')
    expect(connect).toHaveBeenCalledTimes(2)

    finishes[0]({ id: 'c2', state: 'connected' })
    await first
    expect(useAppStore.getState().statuses.c2?.state).toBe('connecting')

    finishes[1]({ id: 'c2', state: 'connected' })
    await Promise.all([disconnecting, retry])
    expect(useAppStore.getState().statuses.c2?.state).toBe('connected')
  })

  it('runs the bounded default query only on first collection open', async () => {
    const execute = vi.fn().mockResolvedValue({
      kind: 'documents',
      data: [],
      count: 0,
      truncated: false,
      collection: 'orders'
    })
    vi.stubGlobal('window', {
      api: {
        shell: { execute },
        history: { list: vi.fn().mockResolvedValue([]) }
      }
    })

    useAppStore.getState().browseCollection('shop', 'orders')

    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce())
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: 'c1',
        database: 'shop',
        code: 'db.orders.find({}).sort({ _id: -1 }).limit(100)',
        skip: 0
      })
    )

    useAppStore.getState().browseCollection('shop', 'orders')
    expect(execute).toHaveBeenCalledOnce()
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
