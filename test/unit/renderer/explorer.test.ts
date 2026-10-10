import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  canDisconnectConnection,
  Explorer,
  filterExplorerRows,
  flattenCatalog
} from '../../../src/renderer/src/components/explorer/Explorer'
import type { CatalogState } from '../../../src/renderer/src/store/useAppStore'

const testStore = vi.hoisted(() => ({ state: {} as Record<string, unknown> }))

vi.mock('@renderer/store/useAppStore', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown): unknown => selector(testStore.state)
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

describe('explorer search grouping', () => {
  type Row = Parameters<typeof filterExplorerRows>[0][number]
  const connectionRow = (id: string, name: string): Row => ({
    type: 'connection',
    id,
    conn: { ...connection, id, name },
    state: 'connected',
    expandable: true,
    expanded: true,
    loading: false
  })
  const treeRow = (connId: string, label: string, depth: number, path = label): Row => ({
    type: 'tree',
    id: `${connId}:${depth}:${path}`,
    connId,
    label,
    depth,
    icon: depth === 1 ? 'database' : 'collection',
    kind: depth === 1 ? 'database' : 'collection',
    expandable: true,
    expanded: true,
    loading: false
  })
  const rows = [
    connectionRow('c1', 'Development'),
    treeRow('c1', 'shop', 1),
    treeRow('c1', 'orders', 2, 'shop/orders'),
    treeRow('c1', 'products', 2),
    treeRow('c1', 'archive', 1),
    treeRow('c1', 'orders', 2, 'archive/orders'),
    connectionRow('c2', 'Production'),
    treeRow('c2', 'shop', 1),
    treeRow('c2', 'orders', 2),
    connectionRow('c3', 'Other'),
    treeRow('c3', 'shop', 1),
    treeRow('c3', 'products', 2)
  ]

  it('keeps each matching collection under its connection and database in the original order', () => {
    expect(filterExplorerRows(rows, ' Orders ')).toEqual([
      rows[0],
      rows[1],
      rows[2],
      rows[4],
      rows[5],
      rows[6],
      rows[7],
      rows[8]
    ])
  })

  it('keeps the ancestor path for a matching nested index', () => {
    const nestedRows = [
      ...rows.slice(0, 3),
      { ...treeRow('c1', 'Indexes', 3), kind: 'indexes' as const },
      { ...treeRow('c1', 'orderId_1', 4), kind: 'index' as const }
    ]
    expect(filterExplorerRows(nestedRows, 'orderId')).toEqual(nestedRows)
  })

  it('preserves connection name and host search, empty search, and no results', () => {
    expect(filterExplorerRows(rows, 'archive')).toEqual([rows[0], rows[4], rows[5]])
    expect(filterExplorerRows(rows, 'Production')).toEqual(rows.slice(6, 9))
    expect(filterExplorerRows(rows, 'LOCALHOST')).toEqual(rows)
    expect(filterExplorerRows(rows, '   ')).toBe(rows)
    expect(filterExplorerRows(rows, 'missing')).toEqual([])
  })

  it('keeps expanded collection tools visible and permits collapsing the revealed path', () => {
    const catalog: CatalogState = {
      databases: [{ name: 'shop' }],
      collections: {
        shop: [
          { name: 'orders', type: 'collection' },
          { name: 'products', type: 'collection' }
        ]
      },
      indexes: {
        'shop/orders': [{ name: 'customer_1', key: { customer: 1 } }]
      },
      users: {},
      expanded: new Set(['c1:coll:shop/orders']),
      loading: new Set()
    }
    const actions = {
      toggleNode: vi.fn(),
      setActiveConnection: vi.fn(),
      browseCollection: vi.fn(),
      inspectIndex: vi.fn()
    }
    const rows = [
      { ...connectionRow('c1', 'Development'), expanded: false },
      ...flattenCatalog('c1', catalog, actions, 'alpha', true)
    ]
    const visible = (): Row[] => filterExplorerRows(rows, 'orders')
    expect(visible().map((row) => (row.type === 'connection' ? row.conn.name : row.label))).toEqual([
      'Development',
      'shop',
      'orders',
      'Indexes'
    ])
    expect(visible().map((row) => row.expanded)).toEqual([true, true, true, false])
    expect(filterExplorerRows(rows, 'orders', undefined, new Map([['c1', false]]))).toHaveLength(1)
    expect(
      filterExplorerRows(rows, 'orders', undefined, new Map([['c1:coll:shop/orders', false]]))
    ).toHaveLength(3)
    expect(
      filterExplorerRows(rows, 'orders', undefined, new Map([['c1:idx:shop/orders', true]])).at(-1)?.id
    ).toBe('c1:idx:shop/orders:customer_1')
    expect(actions.toggleNode).not.toHaveBeenCalled()
    expect(catalog.expanded).toEqual(new Set(['c1:coll:shop/orders']))
    const collectionRow = visible()[2]
    const indexesRow = visible()[3]
    if (collectionRow.type !== 'tree' || indexesRow.type !== 'tree') throw new Error('Expected catalog rows')
    collectionRow.onToggle?.()
    indexesRow.onClick?.()
    collectionRow.onDoubleClick?.()
    expect(actions.toggleNode.mock.calls).toEqual([
      ['c1', 'c1:coll:shop/orders', 'collection', { db: 'shop', coll: 'orders' }],
      ['c1', 'c1:idx:shop/orders', 'indexes', { db: 'shop', coll: 'orders' }]
    ])
    expect(actions.browseCollection).toHaveBeenCalledWith('shop', 'orders')
  })

  it('reveals a matching index without opening unrelated indexes or collections', () => {
    const nested = [
      { ...connectionRow('c1', 'Development'), expanded: false },
      { ...treeRow('c1', 'shop', 1), expanded: false },
      { ...treeRow('c1', 'orders', 2), expanded: false },
      {
        ...treeRow('c1', 'Indexes', 3),
        kind: 'indexes' as const,
        expanded: false
      },
      {
        ...treeRow('c1', 'customer_1', 4),
        kind: 'index' as const,
        expandable: false
      },
      {
        ...treeRow('c1', '_id_', 4),
        kind: 'index' as const,
        expandable: false
      }
    ]
    expect(filterExplorerRows(nested, 'customer').map((row) => row.id)).toEqual(
      nested.slice(0, 5).map((row) => row.id)
    )
    expect(
      filterExplorerRows(nested, 'customer')
        .slice(0, 4)
        .every((row) => row.expanded)
    ).toBe(true)
    const matchingAncestor = nested.map((row) =>
      row.id === nested[2].id ? { ...row, label: 'customer_orders' } : row
    )
    expect(filterExplorerRows(matchingAncestor, 'customer').map((row) => row.id)).toEqual(
      nested.map((row) => row.id)
    )
  })
})

describe('explorer catalog rows', () => {
  it('searches loaded descendants of collapsed databases without fetching or changing expansion', () => {
    const catalog: CatalogState = {
      databases: [{ name: 'shop' }, { name: 'unloaded' }],
      collections: { shop: [{ name: 'orders', type: 'collection' }] },
      indexes: { 'shop/orders': [{ name: 'orderId_1', key: { orderId: 1 } }] },
      users: {},
      expanded: new Set(),
      loading: new Set()
    }
    const actions = {
      toggleNode: vi.fn(),
      setActiveConnection: vi.fn(),
      browseCollection: vi.fn(),
      inspectIndex: vi.fn()
    }
    expect(flattenCatalog('c1', catalog, actions, 'alpha').map((row) => row.label)).toEqual([
      'shop',
      'unloaded'
    ])
    expect(flattenCatalog('c1', catalog, actions, 'alpha', true).map((row) => row.label)).toEqual([
      'shop',
      'orders',
      'Indexes',
      'orderId_1 { orderId: 1 }',
      'unloaded'
    ])
    expect(catalog.expanded.size).toBe(0)
    expect(actions.toggleNode).not.toHaveBeenCalled()
  })

  it('allows an errored connection to be explicitly disconnected', () => {
    expect(canDisconnectConnection('connected')).toBe(true)
    expect(canDisconnectConnection('connecting')).toBe(true)
    expect(canDisconnectConnection('error')).toBe(true)
    expect(canDisconnectConnection('disconnected')).toBe(false)
  })

  it('reveals database children together after collections finish loading', () => {
    vi.stubGlobal('__APP_VERSION__', 'test')
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
      updateState: { phase: 'idle', availableVersion: null, downloadProgress: null },
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
    expect(renderExplorer()).toContain('class="side-foot-version" title="test">test</span>')

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

    testStore.state.updateState = {
      phase: 'available',
      availableVersion: '26.9.18',
      downloadProgress: null
    }
    expect(renderExplorer()).toContain('Update to 26.9.18')

    testStore.state.updateState = {
      phase: 'downloading',
      availableVersion: '26.9.18',
      downloadProgress: { percent: 42.4 }
    }
    expect(renderExplorer()).toContain('Downloading 42%')

    testStore.state.updateState = {
      phase: 'downloaded',
      availableVersion: '26.9.18',
      downloadProgress: null
    }
    expect(renderExplorer()).toContain('Restart and update')

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
