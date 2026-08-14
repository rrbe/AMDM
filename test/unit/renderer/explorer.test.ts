import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { Explorer } from '../../../src/renderer/src/components/explorer/Explorer'
import type { CatalogState } from '../../../src/renderer/src/store/useAppStore'

const testStore = vi.hoisted(() => ({ state: {} as Record<string, unknown> }))

vi.mock('@renderer/store/useAppStore', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown): unknown =>
    selector(testStore.state)
}))

const connection = {
  id: 'c1',
  name: 'local',
  useSrv: false,
  host: 'localhost',
  port: 27017,
  auth: { type: 'none' as const },
  ssh: { enabled: false },
  tls: { enabled: false },
  createdAt: 1,
  updatedAt: 1
}

describe('explorer catalog rows', () => {
  it('reveals database children together after collections finish loading', () => {
    vi.stubGlobal('__BUILD_ID__', 'test')
    const databaseNodeId = 'c1:db:ezze'
    const catalog: CatalogState = {
      databases: [{ name: 'ezze' }],
      collections: {},
      indexes: {},
      users: {},
      expanded: new Set([databaseNodeId]),
      loading: new Set([databaseNodeId])
    }
    testStore.state = {
      connections: [connection],
      statuses: { c1: { id: 'c1', state: 'connected' } },
      catalogs: { c1: catalog },
      expandedConnections: new Set(['c1']),
      settings: { connectionOrder: [], collectionSort: 'alpha', theme: 'light' },
      updateState: { availableVersion: null },
      connect: vi.fn(),
      disconnect: vi.fn(),
      setActiveConnection: vi.fn(),
      toggleConnectionExpanded: vi.fn(),
      deleteConnection: vi.fn(),
      toggleNode: vi.fn(),
      loadDatabases: vi.fn(),
      loadCollections: vi.fn(),
      loadIndexes: vi.fn(),
      refreshCollection: vi.fn(),
      browseCollection: vi.fn(),
      inspectIndex: vi.fn(),
      updateSettings: vi.fn(),
      showAvailableUpdate: vi.fn()
    }

    const renderExplorer = (): string =>
      renderToStaticMarkup(
        createElement(Explorer, {
          view: 'connections',
          onViewChange: vi.fn(),
          onQueryLoad: vi.fn(),
          onCollapse: vi.fn(),
          onSettings: vi.fn(),
          newConnectionRequested: false,
          onNewConnectionRequestHandled: vi.fn()
        })
      )

    expect(renderExplorer()).not.toContain('>Users</span>')

    catalog.collections.ezze = [
      { name: 'addresses', type: 'collection' },
      { name: 'activitymessages', type: 'collection' }
    ]
    catalog.loading.clear()
    testStore.state.catalogs = { c1: { ...catalog } }

    const loadedDatabase = renderExplorer()
    expect(loadedDatabase.indexOf('activitymessages')).toBeLessThan(
      loadedDatabase.indexOf('addresses')
    )
    expect(loadedDatabase).toContain('>Users</span>')

    const collectionNodeId = 'c1:coll:ezze/addresses'
    catalog.expanded.add(collectionNodeId)
    catalog.loading.add(collectionNodeId)
    testStore.state.catalogs = { c1: { ...catalog } }

    expect(renderExplorer()).not.toContain('>Indexes</span>')

    catalog.collections.ezze = catalog.collections.ezze.map((collection) =>
      collection.name === 'addresses' ? { ...collection, estimatedCount: 42 } : collection
    )
    catalog.indexes['ezze/addresses'] = [{ name: '_id_', key: { _id: 1 } }]
    catalog.loading.clear()
    testStore.state.catalogs = { c1: { ...catalog } }

    expect(renderExplorer()).toContain('>Indexes</span>')
  })
})
