import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore, type CatalogState } from '../../../src/renderer/src/store/useAppStore'

describe('offline catalog search lifecycle', () => {
  const catalog: CatalogState = {
    owner: Symbol(),
    databases: [{ name: 'shop' }],
    collections: { shop: [{ name: 'orders', type: 'collection', estimatedCount: 42 }] },
    indexes: {},
    users: {},
    expanded: new Set(['c1:db:shop']),
    loading: new Set()
  }

  beforeEach(() => {
    useAppStore.setState(useAppStore.getInitialState(), true)
    useAppStore.setState({
      catalogs: { c1: catalog },
      statuses: { c1: { id: 'c1', state: 'connected' } },
      expandedConnections: new Set(['c1'])
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('keeps namespace-only search data while releasing the live catalog on disconnect', async () => {
    vi.stubGlobal('window', { api: { session: { disconnect: vi.fn().mockResolvedValue(undefined) } } })
    await useAppStore.getState().disconnect('c1')
    const state = useAppStore.getState()
    expect(state.catalogs.c1).toBeUndefined()
    expect(state.catalogSearchSnapshots.c1).toEqual({
      databases: [{ name: 'shop' }],
      collections: { shop: [{ name: 'orders', type: 'collection' }] }
    })
    expect(state.expandedConnections.has('c1')).toBe(false)
    await state.disconnect('c1')
    expect(useAppStore.getState().catalogSearchSnapshots.c1).toBe(state.catalogSearchSnapshots.c1)
  })

  it('retains the snapshot after a failed reconnect and discards it after success', async () => {
    const connect = vi
      .fn()
      .mockResolvedValueOnce({ id: 'c1', state: 'error', error: 'offline' })
      .mockResolvedValueOnce({ id: 'c1', state: 'connected' })
    vi.stubGlobal('window', {
      api: {
        session: { connect },
        catalog: { databases: vi.fn().mockResolvedValue([{ name: 'fresh' }]) }
      }
    })
    await useAppStore.getState().connect('c1')
    expect(useAppStore.getState().catalogSearchSnapshots.c1.collections.shop[0].name).toBe('orders')
    await useAppStore.getState().connect('c1')
    expect(useAppStore.getState().catalogSearchSnapshots.c1).toBeUndefined()
    expect(useAppStore.getState().catalogs.c1.databases).toEqual([{ name: 'fresh' }])
  })

  it('removes cached namespaces when their connection is deleted', async () => {
    vi.stubGlobal('window', {
      api: {
        session: { disconnect: vi.fn().mockResolvedValue(undefined) },
        connections: { delete: vi.fn().mockResolvedValue(undefined), list: vi.fn().mockResolvedValue([]) }
      }
    })
    await useAppStore.getState().disconnect('c1')
    await useAppStore.getState().deleteConnection('c1')
    expect(useAppStore.getState().catalogSearchSnapshots.c1).toBeUndefined()
  })
  it.each(['databases', 'collections', 'indexes', 'users'] as const)(
    'discards stale %s responses and errors after disconnect or reconnect', async (kind) => {
      for (const reconnect of [false, true]) {
        for (const fail of [false, true]) {
          useAppStore.setState({ catalogs: { c1: { ...catalog } }, notifications: [] })
          let resolve!: (value: never[]) => void
          let reject!: (error: Error) => void
          const pending = new Promise<never[]>((res, rej) => { resolve = res; reject = rej })
          vi.stubGlobal('window', { api: {
            session: { disconnect: vi.fn().mockResolvedValue(undefined), connect: vi.fn().mockResolvedValue({ id: 'c1', state: 'connected' }) },
            catalog: { [kind]: vi.fn().mockReturnValueOnce(pending) }
          } })
          const actions = useAppStore.getState()
          const request = kind === 'databases' ? actions.loadDatabases('c1')
            : kind === 'collections' ? actions.loadCollections('c1', 'shop')
            : kind === 'indexes' ? actions.loadIndexes('c1', 'shop', 'orders')
            : actions.loadUsers('c1', 'shop')
          await actions.disconnect('c1')
          if (reconnect) {
            window.api.catalog.databases = vi.fn().mockResolvedValue([{ name: 'fresh' }])
            await actions.connect('c1')
          }
          const before = useAppStore.getState().catalogs.c1
          if (fail) reject(new Error('stale failure'))
          else resolve([])
          await request
          expect(useAppStore.getState().catalogs.c1).toBe(before)
          expect(useAppStore.getState().notifications).toEqual([])
        }
      }
    }
  )

})
