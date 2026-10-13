import { describe, expect, it } from 'vitest'
import {
  catalogSearchDocuments,
  storedSearchDocuments,
  tabSearchDocuments
} from '../../../src/renderer/src/lib/quickSearch/documents'
import { createTab } from '../../../src/renderer/src/lib/tabs'
import type { ConnectionConfig, HistoryEntry } from '../../../src/shared/types'
import { useAppStore } from '../../../src/renderer/src/store/useAppStore'

const connections = [
  { id: 'c1', name: 'One', host: 'localhost', auth: { type: 'none' } },
  { id: 'c2', name: 'Two', host: 'localhost', auth: { type: 'none' } }
] as ConnectionConfig[]

describe('quick search sources', () => {
  it('activates a foreign result atomically, without transient visits to its previous result', () => {
    const results = ['first', 'target'].map((id) => ({
      id,
      seq: 1,
      executedAt: 1,
      skip: 0,
      query: null,
      result: { kind: 'documents' as const, data: [] },
      resultView: 'json' as const
    }))
    useAppStore.setState({
      tabs: [
        createTab('a', { connectionId: 'c1' }),
        createTab('b', { connectionId: 'c2', results, activeResultId: 'first' })
      ],
      activeTabId: 'a',
      activeConnectionId: 'c1'
    })
    const selections: string[] = []
    const unsubscribe = useAppStore.subscribe((state) => {
      const tab = state.tabs.find((tab) => tab.id === state.activeTabId)!
      selections.push(`${tab.id}/${tab.activeResultId}`)
    })
    useAppStore.getState().setActiveResultTab('target', 'b')
    unsubscribe()
    expect(selections).toEqual(['b/target'])
    expect(useAppStore.getState().activeConnectionId).toBe('c2')
    expect(useAppStore.getState().tabs[1].results).toBe(results)
  })
  it('reveals ancestors without changing the active query or fetching metadata', () => {
    const catalog = {
      databases: [{ name: 'shop' }],
      collections: { shop: [{ name: 'orders', type: 'collection' as const }] },
      indexes: {},
      users: {},
      expanded: new Set<string>(),
      loading: new Set<string>()
    }
    const activeTabId = useAppStore.getState().activeTabId
    useAppStore.setState({
      catalogs: { c1: catalog },
      expandedConnections: new Set(),
      statuses: { c1: { id: 'c1', state: 'connected' } }
    })
    useAppStore.getState().revealCatalog('c1', ['c1:db:shop', 'c1:coll:shop/orders'])
    expect(useAppStore.getState().activeTabId).toBe(activeTabId)
    expect(useAppStore.getState().expandedConnections.has('c1')).toBe(true)
    expect([...useAppStore.getState().catalogs.c1.expanded]).toEqual(['c1:db:shop', 'c1:coll:shop/orders'])
    expect(catalog.expanded.size).toBe(0)
  })
  it('indexes loaded descendants of collapsed connected catalogs with reveal ancestors', () => {
    const catalog = {
      databases: [{ name: 'shop' }],
      collections: { shop: [{ name: 'orders', type: 'collection' as const }] },
      indexes: {},
      users: {},
      expanded: new Set<string>(),
      loading: new Set<string>()
    }
    const result = catalogSearchDocuments(
      connections,
      { c1: { id: 'c1', state: 'connected' } },
      { c1: catalog, c2: catalog },
      'natural'
    )
    expect(result.documents.map((doc) => doc.label)).toEqual(['One', 'shop', 'orders'])
    expect([...result.destinations.values()].at(-1)).toEqual({
      connectionId: 'c1',
      rowId: 'c1:coll:shop/orders',
      ancestors: ['c1:db:shop']
    })
    expect(catalog.expanded.size).toBe(0)
  })

  it('uses execution context for data even when its parent query was edited', () => {
    const tab = createTab('q', {
      connectionId: 'c2',
      activeDatabase: 'new',
      code: 'db.new.find()',
      results: [
        {
          id: 'r',
          seq: 1,
          executedAt: 1,
          skip: 0,
          query: { connectionId: 'c1', database: 'old', code: 'db.old.find()' },
          result: { kind: 'error', error: 'example' }
        }
      ]
    })
    const documents = tabSearchDocuments([tab], connections)
    expect(documents[1]).toMatchObject({ group: 'data', connectionId: 'c1', code: 'db.old.find()' })
    expect(documents[1].detail).toContain('One / old')
  })

  it('merges exact history code within one context and retains all visit identities', () => {
    const history: HistoryEntry[] = [
      { id: 'old', connectionId: 'c1', database: 'shop', code: 'db.orders.find()', ranAt: 1, ok: true },
      { id: 'new', connectionId: 'c1', database: 'shop', code: 'db.orders.find()', ranAt: 2, ok: false },
      { id: 'other', connectionId: 'c2', database: 'shop', code: 'db.orders.find()', ranAt: 3, ok: true }
    ]
    const documents = storedSearchDocuments([], history, connections)
    expect(documents).toHaveLength(2)
    expect(documents[0]).toMatchObject({
      id: '["history","new"]',
      count: 2,
      visitIds: ['["history","old"]', '["history","new"]']
    })
    expect(history).toHaveLength(3)
  })
})
