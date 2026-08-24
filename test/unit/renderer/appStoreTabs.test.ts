import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTab } from '../../../src/renderer/src/lib/tabs'
import { useAppStore } from '../../../src/renderer/src/store/useAppStore'
import { DEFAULT_SETTINGS, type ShellResult } from '../../../src/shared/types'

describe('connection-bound tabs', () => {
  beforeEach(() => {
    useAppStore.setState({
      tabs: [createTab('c1-tab', { connectionId: 'c1' })],
      activeTabId: 'c1-tab',
      activeConnectionId: 'c1',
      statuses: {},
      notifications: []
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

  it('connects in the explorer without creating or focusing a query tab', async () => {
    const connect = vi.fn().mockResolvedValue({ id: 'c2', state: 'connected' })
    vi.stubGlobal('window', {
      api: {
        session: { connect },
        catalog: { databases: vi.fn().mockResolvedValue([]) }
      }
    })
    const tabs = useAppStore.getState().tabs

    await useAppStore.getState().connect('c2')

    expect(useAppStore.getState().tabs).toBe(tabs)
    expect(useAppStore.getState().activeTabId).toBe('c1-tab')
    expect(useAppStore.getState().activeConnectionId).toBe('c1')
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

  it('surfaces a failed connection and clears it on retry', async () => {
    const connect = vi
      .fn()
      .mockResolvedValueOnce({ id: 'c2', state: 'error', error: 'getaddrinfo ENOTFOUND db2' })
      .mockResolvedValueOnce({ id: 'c2', state: 'connected' })
    vi.stubGlobal('window', {
      api: {
        session: { connect },
        catalog: { databases: vi.fn().mockResolvedValue([]) }
      }
    })
    useAppStore.setState({ statuses: {}, catalogs: {}, notifications: [] })

    await useAppStore.getState().connect('c2')
    expect(useAppStore.getState().statuses.c2).toMatchObject({ state: 'error' })
    expect(useAppStore.getState().notifications.at(-1)).toMatchObject({
      variant: 'error',
      detail: 'getaddrinfo ENOTFOUND db2'
    })

    await useAppStore.getState().connect('c2')
    expect(useAppStore.getState().statuses.c2).toMatchObject({ state: 'connected' })
    expect(useAppStore.getState().notifications.at(-1)?.variant).toBe('success')
  })

  it('syncs driver heartbeat status without clearing tab data', () => {
    const tabs = useAppStore.getState().tabs
    useAppStore.getState().syncSessionStatus({
      id: 'c1',
      state: 'error',
      error: 'socket closed'
    })

    expect(useAppStore.getState().statuses.c1).toMatchObject({
      state: 'error',
      error: 'socket closed'
    })
    expect(useAppStore.getState().notifications.at(-1)).toMatchObject({
      variant: 'error',
      source: 'connection',
      detail: 'socket closed'
    })
    expect(useAppStore.getState().tabs).toBe(tabs)
  })

  it('syncs persisted settings to the other renderer window', async () => {
    let receive!: (event: MessageEvent) => void
    const channel = {
      addEventListener: vi.fn((_type: string, listener: (event: MessageEvent) => void) => {
        receive = listener
      }),
      postMessage: vi.fn()
    }
    class FakeBroadcastChannel {
      addEventListener = channel.addEventListener
      postMessage = channel.postMessage
    }
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
    const listHistory = vi.fn().mockResolvedValue([])
    vi.stubGlobal('window', {
      api: {
        history: { list: listHistory },
        settings: {
          get: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
          update: vi.fn().mockImplementation((patch) => Promise.resolve({ ...DEFAULT_SETTINGS, ...patch }))
        }
      }
    })

    await useAppStore.getState().loadSettings()
    await useAppStore.getState().updateSettings({ collectionSort: 'alpha' })
    expect(channel.postMessage).toHaveBeenCalledWith(expect.objectContaining({ collectionSort: 'alpha' }))

    receive({ data: { ...DEFAULT_SETTINGS, collectionSort: 'natural' } } as MessageEvent)
    expect(useAppStore.getState().settings.collectionSort).toBe('natural')

    receive({ data: { ...DEFAULT_SETTINGS, historyLimit: 100 } } as MessageEvent)
    await vi.waitFor(() => expect(listHistory).toHaveBeenCalledOnce())
  })

  it('refreshes only the requested database collections', async () => {
    const collections = vi.fn().mockResolvedValue([{ name: 'fresh', type: 'collection' }])
    vi.stubGlobal('window', { api: { catalog: { collections } } })
    const c1 = {
      databases: [{ name: 'db1' }],
      collections: { db1: [{ name: 'stale', type: 'collection' as const }] },
      indexes: {},
      users: {},
      expanded: new Set<string>(),
      loading: new Set<string>()
    }
    const c2 = {
      databases: [{ name: 'other' }],
      collections: { other: [{ name: 'untouched', type: 'collection' as const }] },
      indexes: {},
      users: {},
      expanded: new Set<string>(),
      loading: new Set<string>()
    }
    const tabs = useAppStore.getState().tabs
    useAppStore.setState({ catalogs: { c1, c2 } })

    await useAppStore.getState().loadCollections('c1', 'db1')

    expect(collections).toHaveBeenCalledWith('c1', 'db1')
    expect(useAppStore.getState().catalogs.c1.collections.db1?.[0]?.name).toBe('fresh')
    expect(useAppStore.getState().catalogs.c2).toBe(c2)
    expect(useAppStore.getState().tabs).toBe(tabs)
  })

  it('loads collection and index counts together after collection expansion', async () => {
    let resolveCount!: (count: number) => void
    let resolveIndexes!: (indexes: Array<{ name: string; key: Record<string, unknown> }>) => void
    const collectionCount = vi.fn(() => new Promise<number>((resolve) => (resolveCount = resolve)))
    const indexes = vi.fn(
      () => new Promise<Array<{ name: string; key: Record<string, unknown> }>>((resolve) => (resolveIndexes = resolve))
    )
    vi.stubGlobal('window', { api: { catalog: { collectionCount, indexes } } })
    const collection = { name: 'orders', type: 'collection' as const }
    useAppStore.setState({
      catalogs: {
        c1: {
          databases: [{ name: 'db1' }],
          collections: { db1: [collection] },
          indexes: {},
          users: {},
          expanded: new Set<string>(),
          loading: new Set<string>()
        }
      }
    })

    const nodeId = 'c1:coll:db1/orders'
    await useAppStore.getState().toggleNode('c1', nodeId, 'collection', {
      db: 'db1',
      coll: 'orders'
    })

    expect(collectionCount).toHaveBeenCalledWith('c1', 'db1', 'orders')
    expect(indexes).toHaveBeenCalledWith('c1', 'db1', 'orders')
    expect(useAppStore.getState().catalogs.c1.expanded.has(nodeId)).toBe(true)
    expect(useAppStore.getState().catalogs.c1.loading.has(nodeId)).toBe(true)
    expect(useAppStore.getState().catalogs.c1.collections.db1?.[0].estimatedCount).toBeUndefined()

    resolveCount(42)
    await Promise.resolve()
    expect(useAppStore.getState().catalogs.c1.collections.db1?.[0].estimatedCount).toBeUndefined()
    expect(useAppStore.getState().catalogs.c1.indexes['db1/orders']).toBeUndefined()

    const loadedIndexes = [{ name: '_id_', key: { _id: 1 } }]
    resolveIndexes(loadedIndexes)
    await vi.waitFor(() => {
      expect(useAppStore.getState().catalogs.c1.collections.db1?.[0].estimatedCount).toBe(42)
      expect(useAppStore.getState().catalogs.c1.indexes['db1/orders']).toBe(loadedIndexes)
      expect(useAppStore.getState().catalogs.c1.loading.has(nodeId)).toBe(false)
    })

    await useAppStore.getState().toggleNode('c1', 'c1:idx:db1/orders', 'indexes', {
      db: 'db1',
      coll: 'orders'
    })
    expect(indexes).toHaveBeenCalledTimes(1)
  })

  it('refreshes one collection estimated count and indexes together', async () => {
    const collectionCount = vi.fn().mockResolvedValue(84)
    const indexes = vi.fn().mockResolvedValue([
      { name: '_id_', key: { _id: 1 } },
      { name: 'status_1', key: { status: 1 } }
    ])
    vi.stubGlobal('window', { api: { catalog: { collectionCount, indexes } } })
    const collection = { name: 'orders', type: 'collection' as const, estimatedCount: 42 }
    const untouched = { name: 'users', type: 'collection' as const, estimatedCount: 12 }
    const oldIndexes = [{ name: '_id_', key: { _id: 1 } }]
    useAppStore.setState({
      catalogs: {
        c1: {
          databases: [{ name: 'db1' }],
          collections: { db1: [collection, untouched] },
          indexes: { 'db1/orders': oldIndexes },
          users: {},
          expanded: new Set<string>(),
          loading: new Set<string>()
        }
      }
    })

    await useAppStore.getState().refreshCollection('c1', 'db1', 'orders')

    expect(collectionCount).toHaveBeenCalledWith('c1', 'db1', 'orders')
    expect(indexes).toHaveBeenCalledWith('c1', 'db1', 'orders')
    expect(useAppStore.getState().catalogs.c1.collections.db1).toEqual([
      { ...collection, estimatedCount: 84 },
      untouched
    ])
    expect(useAppStore.getState().catalogs.c1.indexes['db1/orders']).toHaveLength(2)
    expect(useAppStore.getState().catalogs.c1.loading.size).toBe(0)
  })

  it('refreshes only the requested connection database list', async () => {
    const databases = vi.fn().mockResolvedValue([{ name: 'fresh' }])
    vi.stubGlobal('window', { api: { catalog: { databases } } })
    const collections = { old: [{ name: 'kept', type: 'collection' as const }] }
    const c1 = {
      databases: [{ name: 'old' }],
      collections,
      indexes: {},
      users: {},
      expanded: new Set<string>(),
      loading: new Set<string>()
    }
    const c2 = {
      databases: [{ name: 'untouched' }],
      collections: {},
      indexes: {},
      users: {},
      expanded: new Set<string>(),
      loading: new Set<string>()
    }
    const tabs = useAppStore.getState().tabs
    useAppStore.setState({ catalogs: { c1, c2 } })

    await useAppStore.getState().loadDatabases('c1')

    expect(databases).toHaveBeenCalledWith('c1')
    expect(useAppStore.getState().catalogs.c1.databases?.[0]?.name).toBe('fresh')
    expect(useAppStore.getState().catalogs.c1.collections).toBe(collections)
    expect(useAppStore.getState().catalogs.c2).toBe(c2)
    expect(useAppStore.getState().tabs).toBe(tabs)
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

  it('runs and refreshes one index detail query without duplicating an in-flight run', async () => {
    const finishes: ((result: ShellResult) => void)[] = []
    const execute = vi.fn(
      () =>
        new Promise<ShellResult>((resolve) => {
          finishes.push(resolve)
        })
    )
    vi.stubGlobal('window', {
      api: {
        shell: { execute },
        history: { list: vi.fn().mockResolvedValue([]) }
      }
    })

    useAppStore.getState().inspectIndex('shop', 'orders', 'status_1_createdAt_-1')
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: 'c1',
        database: 'shop',
        code: '(await db.orders.getIndexes()).filter((index) => index.name === "status_1_createdAt_-1")',
        skip: 0
      })
    )

    useAppStore.getState().inspectIndex('shop', 'orders', 'status_1_createdAt_-1')
    expect(execute).toHaveBeenCalledOnce()

    finishes[0]({ kind: 'documents', data: [], count: 0, truncated: false })
    await vi.waitFor(() => expect(useAppStore.getState().tabs[0].running).toBe(false))

    useAppStore.getState().inspectIndex('shop', 'orders', 'status_1_createdAt_-1')
    expect(execute).toHaveBeenCalledTimes(2)
    expect(useAppStore.getState().tabs).toHaveLength(1)
    finishes[1]({ kind: 'documents', data: [], count: 0, truncated: false })
    await vi.waitFor(() => expect(useAppStore.getState().tabs[0].running).toBe(false))
  })

  it('shows running, keeps real failures red, and clears a stopped run', async () => {
    let finish!: (result: ShellResult) => void
    const execute = vi.fn(
      () =>
        new Promise<ShellResult>((resolve) => {
          finish = resolve
        })
    )
    const abort = vi.fn().mockResolvedValue(true)
    vi.stubGlobal('window', {
      api: {
        shell: { execute, abort },
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
    expect(useAppStore.getState().tabs[0]).toMatchObject({
      running: true,
      stopping: false,
      runFailed: false
    })
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ timeoutMS: 30_000 }))
    finish({
      kind: 'error',
      errorName: 'MongoServerError',
      error: 'operation exceeded time limit',
      failureKind: 'timeout'
    })
    await failedRun
    expect(useAppStore.getState().tabs[0]).toMatchObject({ running: false, runFailed: true })
    expect(useAppStore.getState().notifications.at(-1)).toMatchObject({
      variant: 'error',
      source: 'query',
      detail: 'operation exceeded time limit',
      dedupeKey: 'query:c1-tab:timeout'
    })
    const notificationCount = useAppStore.getState().notifications.length

    const stoppedRun = useAppStore.getState().runShell()
    const stopping = useAppStore.getState().stopShell()
    expect(useAppStore.getState().tabs[0]).toMatchObject({ running: true, stopping: true })
    void useAppStore.getState().stopShell()
    expect(abort).toHaveBeenCalledOnce()
    await stopping
    finish({ kind: 'error', errorName: 'Aborted', error: '执行已停止' })
    await stoppedRun
    expect(useAppStore.getState().tabs[0]).toMatchObject({
      running: false,
      stopping: false,
      runFailed: false
    })
    expect(useAppStore.getState().notifications).toHaveLength(notificationCount)
  })

  it('stores the exact executed selection on its result tab', async () => {
    const execute = vi.fn().mockResolvedValue({
      kind: 'documents',
      data: [],
      count: 0,
      truncated: false,
      collection: 'audit'
    } satisfies ShellResult)
    vi.stubGlobal('window', { api: { shell: { execute } } })
    const selection = `const ids = await db.orders.distinct('_id', { status: 'open' })

db.audit.find({ orderId: { $in: ids } }).limit(20)`
    const editorCode = `db.unselectedBefore.find({})

${selection}

db.unselectedAfter.find({})`
    useAppStore.setState({
      tabs: [
        createTab('c1-tab', {
          connectionId: 'c1',
          activeDatabase: 'shop',
          code: editorCode
        })
      ],
      activeTabId: 'c1-tab'
    })

    await useAppStore.getState().runShell(selection)

    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ code: selection }))
    expect(useAppStore.getState().tabs[0].results[0].query?.code).toBe(selection)
  })
})
