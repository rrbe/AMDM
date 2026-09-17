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

  it('opens and duplicates tabs beside the right-clicked tab with independent query state', () => {
    useAppStore.setState({
      tabs: [
        createTab('source', {
          connectionId: 'c2',
          activeDatabase: 'shop',
          code: 'db.orders.find({})',
          runtime: 'mongosh',
          results: [
            {
              id: 'result',
              seq: 1,
              result: { kind: 'documents', data: [] },
              executedAt: 1,
              query: null,
              skip: 0,
              resultView: 'tree'
            }
          ],
          running: true,
          runningExecId: 'running-query'
        }),
        createTab('other', { connectionId: 'c1' })
      ],
      activeTabId: 'other',
      activeConnectionId: 'c1'
    })

    useAppStore.getState().newTab('source')
    const blank = useAppStore.getState().tabs[1]
    expect(blank).toMatchObject({ connectionId: 'c2', code: '', results: [] })
    expect(useAppStore.getState().activeConnectionId).toBe('c2')

    useAppStore.getState().duplicateTab('source')
    const copy = useAppStore.getState().tabs[1]
    expect(copy).toMatchObject({
      connectionId: 'c2',
      activeDatabase: 'shop',
      code: 'db.orders.find({})',
      runtime: 'mongosh',
      pristine: false,
      results: [],
      running: false,
      runningExecId: null
    })
    expect(copy.id).not.toBe('source')
    expect(useAppStore.getState().tabs.map((tab) => tab.id)).toEqual(['source', copy.id, blank.id, 'other'])
    expect(useAppStore.getState().activeTabId).toBe(copy.id)
  })

  it('keeps the result view independent for each data tab and query tab', () => {
    const result = (id: string) => ({
      id,
      seq: 1,
      result: { kind: 'documents' as const, data: [] },
      executedAt: 1,
      query: null,
      skip: 0,
      resultView: 'tree' as const
    })
    useAppStore.setState({
      tabs: [
        createTab('c1-tab', { connectionId: 'c1', results: [result('r1'), result('r2')], activeResultId: 'r1' }),
        createTab('c2-tab', { connectionId: 'c2', results: [result('r3')], activeResultId: 'r3' })
      ],
      activeTabId: 'c1-tab',
      activeConnectionId: 'c1'
    })

    useAppStore.getState().setResultView('json')
    useAppStore.getState().setActiveResultTab('r2')
    expect(useAppStore.getState().tabs[0].results[1].resultView).toBe('tree')
    useAppStore.getState().setResultView('table')
    useAppStore.getState().setActiveResultTab('r1')
    expect(useAppStore.getState().tabs[0].results[0].resultView).toBe('json')
    useAppStore.getState().setActiveTab('c2-tab')

    expect(useAppStore.getState().tabs[1].results[0].resultView).toBe('tree')

    useAppStore.getState().setResultView('table')
    useAppStore.getState().setActiveTab('c1-tab')

    expect(useAppStore.getState().tabs[0].results.map((r) => r.resultView)).toEqual(['json', 'table'])
    expect(useAppStore.getState().tabs[1].results[0].resultView).toBe('table')
  })

  it('retains column order across query reruns, refreshes, and result/view switches', async () => {
    const execute = vi.fn().mockResolvedValue({ kind: 'documents', data: [{ _id: 1, name: 'item' }] })
    vi.stubGlobal('window', {
      api: { shell: { execute }, history: { list: vi.fn().mockResolvedValue([]) } }
    })
    useAppStore.getState().setCode('db.items.find({})')
    useAppStore.getState().setTableColumnOrder(['name', '_id'])
    const order = useAppStore.getState().tabs[0].tableColumnOrder

    await useAppStore.getState().runShell()
    const firstResultId = useAppStore.getState().tabs[0].activeResultId
    await useAppStore.getState().runShell()
    expect(useAppStore.getState().tabs[0].activeResultId).not.toBe(firstResultId)
    await useAppStore.getState().loadPage(0)
    expect(execute).toHaveBeenCalledTimes(3)
    useAppStore.getState().setActiveResultTab(firstResultId!)
    useAppStore.getState().setResultView('json')
    useAppStore.getState().setResultView('table')

    expect(useAppStore.getState().tabs[0].tableColumnOrder).toBe(order)
  })

  it('isolates column order per query tab and releases it when the tab closes', () => {
    const other = createTab('c2-tab', { connectionId: 'c2' })
    useAppStore.setState({ tabs: [...useAppStore.getState().tabs, other] })
    useAppStore.getState().setTableColumnOrder(['name', '_id'])
    expect(useAppStore.getState().tabs[1]).toBe(other)
    useAppStore.getState().setActiveTab('c2-tab')
    expect(useAppStore.getState().tabs[1].tableColumnOrder).toEqual([])
    useAppStore.getState().setTableColumnOrder(['_id', 'name'])
    useAppStore.getState().setActiveTab('c1-tab')
    expect(useAppStore.getState().tabs[0].tableColumnOrder).toEqual(['name', '_id'])
    useAppStore.getState().closeTab('c1-tab')
    expect(useAppStore.getState().tabs.map((tab) => tab.id)).toEqual(['c2-tab'])
    expect(useAppStore.getState().tabs[0].tableColumnOrder).toEqual(['_id', 'name'])
    useAppStore.getState().closeTab('c2-tab')
    expect(useAppStore.getState().tabs[0].tableColumnOrder).toEqual([])
  })

  it('closes selected tabs together, aborts their runs, and keeps a surviving connection active', () => {
    const abort = vi.fn().mockResolvedValue(true)
    vi.stubGlobal('window', { api: { shell: { abort } } })
    useAppStore.setState({
      tabs: [
        createTab('left', { connectionId: 'c2' }),
        createTab('middle', { connectionId: 'c1', runningExecId: 'run-middle' }),
        createTab('right', { connectionId: 'c1', runningExecId: 'run-right' })
      ],
      activeTabId: 'right',
      activeConnectionId: 'c1'
    })

    useAppStore.getState().closeTabs(['middle', 'right'])

    expect(abort).toHaveBeenCalledWith('run-middle')
    expect(abort).toHaveBeenCalledWith('run-right')
    expect(useAppStore.getState()).toMatchObject({ activeTabId: 'left', activeConnectionId: 'c2' })
    expect(useAppStore.getState().tabs.map((tab) => tab.id)).toEqual(['left'])
  })

  it('moves query tabs without changing focus, connection, or the state owned by each tab', () => {
    const tabs = [
      createTab('first', { connectionId: 'c1', code: 'db.orders.find({})', pristine: false }),
      createTab('second', { connectionId: 'c2', running: true, runningExecId: 'running-query' }),
      createTab('third', { connectionId: 'c3' })
    ]
    useAppStore.setState({ tabs, activeTabId: 'second', activeConnectionId: 'c2' })

    useAppStore.getState().moveQueryTab('second', 'third')
    const moved = useAppStore.getState()
    expect(moved.tabs.map((tab) => tab.id)).toEqual(['first', 'third', 'second'])
    expect(moved.tabs[2]).toBe(tabs[1])
    expect(moved.tabs[0]).toBe(tabs[0])
    expect(moved.tabs[1]).toBe(tabs[2])
    expect(moved.activeTabId).toBe('second')
    expect(moved.activeConnectionId).toBe('c2')

    useAppStore.getState().moveQueryTab('second', 'first')
    expect(useAppStore.getState().tabs.map((tab) => tab.id)).toEqual(['second', 'first', 'third'])
    const unchanged = useAppStore.getState()
    useAppStore.getState().moveQueryTab('second', 'second')
    useAppStore.getState().moveQueryTab('closed-tab', 'first')
    expect(useAppStore.getState()).toBe(unchanged)
  })

  it('moves results only within their query tab and closes the next visual neighbor', () => {
    const results = [1, 2, 3].map((seq) => ({
      id: `r${seq}`,
      seq,
      result: { kind: 'value', data: seq } as ShellResult,
      executedAt: seq,
      query: null,
      skip: seq * 10
    }))
    const other = createTab('other', { connectionId: 'c2' })
    useAppStore.setState({
      tabs: [createTab('c1-tab', { results, activeResultId: 'r1', resultSeq: 3 }), other]
    })

    useAppStore.getState().moveResultTab('r1', 'r3')
    const moved = useAppStore.getState()
    expect(moved.tabs[0].results.map((result) => result.id)).toEqual(['r2', 'r3', 'r1'])
    expect(moved.tabs[0].results[2]).toBe(results[0])
    expect(moved.tabs[0].results[0]).toBe(results[1])
    expect(moved.tabs[0].activeResultId).toBe('r1')
    expect(moved.tabs[0].resultSeq).toBe(3)
    expect(moved.tabs[1]).toBe(other)

    useAppStore.getState().closeResultTab('r1')
    expect(useAppStore.getState().tabs[0].activeResultId).toBe('r3')
    useAppStore.getState().setActiveTab('other')
    const unchanged = useAppStore.getState()
    useAppStore.getState().moveResultTab('r2', 'r3')
    expect(useAppStore.getState()).toBe(unchanged)
  })

  it('keeps runtime per tab and clears results when it changes', () => {
    const prepare = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('window', { api: { shell: { prepare } } })
    useAppStore.setState({
      tabs: [
        createTab('c1-tab', {
          connectionId: 'c1',
          results: [
            {
              id: 'result-1',
              seq: 1,
              result: { kind: 'value', data: 1 },
              executedAt: 1,
              query: null,
              skip: 0
            }
          ],
          activeResultId: 'result-1',
          resultSeq: 1
        })
      ]
    })

    useAppStore.getState().setShellRuntime('mongosh')

    expect(useAppStore.getState().tabs[0]).toMatchObject({
      runtime: 'mongosh',
      results: [],
      activeResultId: null,
      resultSeq: 0
    })
    expect(prepare).toHaveBeenCalledWith('mongosh')
  })

  it('uses the configured runtime for new query tabs', () => {
    useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, defaultShellRuntime: 'legacy' } })

    useAppStore.getState().newTab()

    expect(useAppStore.getState().tabs.at(-1)?.runtime).toBe('legacy')
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

  it('discards late results and notifications after their query tab closes', async () => {
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
        createTab('closing-tab', {
          connectionId: 'c1',
          activeDatabase: 'test',
          code: 'db.items.find({})'
        }),
        createTab('remaining-tab', { connectionId: 'c1' })
      ],
      activeTabId: 'closing-tab',
      notifications: []
    })

    const run = useAppStore.getState().runShell()
    const execId = execute.mock.calls[0][0].execId
    useAppStore.getState().closeTab('closing-tab')
    expect(abort).toHaveBeenCalledWith(execId)

    finish({
      kind: 'error',
      errorName: 'MongoServerError',
      error: 'late failure',
      failureKind: 'server'
    })
    await run

    expect(useAppStore.getState().tabs).toHaveLength(1)
    expect(useAppStore.getState().tabs[0]).toMatchObject({ id: 'remaining-tab', results: [] })
    expect(useAppStore.getState().notifications).toEqual([])
  })

  it('isolates ten concurrent query tabs when they are closed before completion', async () => {
    const finishes: ((result: ShellResult) => void)[] = []
    const execute = vi.fn(
      () =>
        new Promise<ShellResult>((resolve) => {
          finishes.push(resolve)
        })
    )
    const abort = vi.fn().mockResolvedValue(true)
    vi.stubGlobal('window', {
      api: {
        shell: { execute, abort },
        history: { list: vi.fn().mockResolvedValue([]) }
      }
    })

    const queryTabs = Array.from({ length: 10 }, (_, index) =>
      createTab(`query-${index}`, {
        connectionId: 'c1',
        activeDatabase: 'test',
        code: `db.items.findOne({ index: ${index} })`,
        runtime: 'mongosh'
      })
    )
    useAppStore.setState({
      tabs: [...queryTabs, createTab('remaining-tab', { connectionId: 'c1' })],
      activeTabId: 'query-0',
      notifications: []
    })

    const runs = queryTabs.map((tab) => {
      useAppStore.setState({ activeTabId: tab.id })
      return useAppStore.getState().runShell()
    })
    expect(execute).toHaveBeenCalledTimes(10)

    for (const tab of queryTabs) useAppStore.getState().closeTab(tab.id)
    expect(abort).toHaveBeenCalledTimes(10)

    for (const finish of finishes) {
      finish({
        kind: 'error',
        errorName: 'MongoServerError',
        error: 'late failure',
        failureKind: 'server'
      })
    }
    await Promise.all(runs)

    expect(useAppStore.getState().tabs).toEqual([
      expect.objectContaining({ id: 'remaining-tab', results: [], running: false })
    ])
    expect(useAppStore.getState().notifications).toEqual([])
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
          code: editorCode,
          runtime: 'mongosh'
        })
      ],
      activeTabId: 'c1-tab'
    })

    await useAppStore.getState().runShell(selection)

    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ code: selection, runtime: 'mongosh' }))
    expect(useAppStore.getState().tabs[0].results[0].query?.code).toBe(selection)
    expect(useAppStore.getState().tabs[0].results[0].query?.runtime).toBe('mongosh')
  })

  it('asks before switching to the runtime required by an unambiguous construct', async () => {
    const execute = vi.fn().mockResolvedValue({ kind: 'value', data: null } satisfies ShellResult)
    const prepare = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('window', {
      api: {
        shell: { execute, prepare },
        history: { list: vi.fn().mockResolvedValue([]) }
      }
    })
    useAppStore.setState({
      tabs: [
        createTab('runtime-tab', {
          connectionId: 'c1',
          activeDatabase: 'test',
          code: 'db.getMongo().startSession()',
          runtime: 'legacy'
        })
      ],
      activeTabId: 'runtime-tab'
    })

    await useAppStore.getState().runShell()

    expect(execute).not.toHaveBeenCalled()
    expect(useAppStore.getState().tabs[0]).toMatchObject({
      runtime: 'legacy',
      runtimeSuggestion: {
        runtime: 'mongosh',
        construct: 'db.getMongo()',
        code: 'db.getMongo().startSession()'
      }
    })

    useAppStore.getState().dismissShellRuntimeSuggestion()
    expect(useAppStore.getState().tabs[0].runtimeSuggestion).toBeNull()
    expect(execute).not.toHaveBeenCalled()

    await useAppStore.getState().runShell()
    await useAppStore.getState().acceptShellRuntimeSuggestion()

    expect(useAppStore.getState().tabs[0].runtime).toBe('mongosh')
    expect(prepare).toHaveBeenCalledWith('mongosh')
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ runtime: 'mongosh' }))
  })
})

describe('result retention notice', () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each(['runShell', 'runExplain'] as const)('notifies only on eviction during %s and merges repeated notices', async (action) => {
    vi.stubGlobal('window', {
      api: {
        shell: { execute: vi.fn().mockResolvedValue({ kind: 'documents', data: [], pageable: true }) },
        history: { list: vi.fn().mockResolvedValue([]) }
      }
    })
    useAppStore.setState({
      tabs: [createTab('retention', { connectionId: 'c1', code: 'db.items.find({})' })],
      activeTabId: 'retention',
      notifications: [],
      settings: DEFAULT_SETTINGS
    })
    for (let i = 0; i < 8; i++) await useAppStore.getState()[action]()
    expect(useAppStore.getState().notifications).toHaveLength(0)
    await useAppStore.getState()[action]()
    expect(useAppStore.getState().tabs[0].results.map((r) => r.seq)).toEqual([2, 3, 4, 5, 6, 7, 8, 9])
    expect(useAppStore.getState().notifications).toEqual([
      expect.objectContaining({ variant: 'info', dedupeKey: 'query:retention:resultRetention', repeatCount: 1 })
    ])
    await useAppStore.getState()[action]()
    expect(useAppStore.getState().notifications).toHaveLength(1)
    expect(useAppStore.getState().notifications[0].repeatCount).toBe(2)
    useAppStore.getState().clearNotifications()
    await useAppStore.getState().refreshResult()
    expect(useAppStore.getState().notifications).toHaveLength(0)
    useAppStore.getState().closeResultTab(useAppStore.getState().tabs[0].activeResultId!)
    await useAppStore.getState()[action]()
    expect(useAppStore.getState().notifications).toHaveLength(0)
  })
})
