import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore, emptyCatalog } from '../../../src/renderer/src/store/useAppStore'

describe('drop collection', () => {
  beforeEach(() => {
    useAppStore.setState({
      activeConnectionId: 'another-connection',
      catalogs: {
        target: {
          ...emptyCatalog(),
          collections: {
            shop: [
              { name: 'orders', type: 'collection' },
              { name: 'keep', type: 'collection' }
            ]
          },
          indexes: { 'shop/orders': [], 'shop/keep': [] },
          expanded: new Set(['target:db:shop', 'target:coll:shop/orders', 'target:idx:shop/orders'])
        },
        other: emptyCatalog()
      },
      fieldCache: {
        'target:shop.orders': ['old'],
        'target:shop.keep': ['keep'],
        'other:shop.orders': ['other']
      },
      notifications: []
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('keeps a busy row, prevents duplicate requests, then invalidates only the dropped namespace', async () => {
    let finish!: () => void
    const dropCollection = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    vi.stubGlobal('window', { api: { catalog: { dropCollection } } })
    const before = useAppStore.getState()
    const operation = before.dropCollection('target', 'shop', 'orders')
    await useAppStore.getState().dropCollection('target', 'shop', 'orders')
    expect(dropCollection).toHaveBeenCalledExactlyOnceWith('target', 'shop', 'orders')
    expect(useAppStore.getState().catalogs.target.loading.has('target:coll:shop/orders')).toBe(true)
    expect(useAppStore.getState().catalogs.target.collections.shop).toHaveLength(2)

    finish()
    await operation
    const after = useAppStore.getState()
    expect(after.catalogs.target.collections.shop?.map((collection) => collection.name)).toEqual(['keep'])
    expect(after.catalogs.target.indexes).toEqual({ 'shop/keep': [] })
    expect(after.catalogs.target.expanded).toEqual(new Set(['target:db:shop']))
    expect(after.catalogs.target.loading.size).toBe(0)
    expect(after.fieldCache).toEqual({
      'target:shop.keep': ['keep'],
      'other:shop.orders': ['other']
    })
    expect(after.catalogs.other).toBe(before.catalogs.other)
    expect(after.tabs).toBe(before.tabs)
    expect(after.activeConnectionId).toBe('another-connection')
  })

  it('keeps data and caches on failure and reports the error once', async () => {
    const dropCollection = vi.fn().mockRejectedValue(new Error('not authorized'))
    vi.stubGlobal('window', { api: { catalog: { dropCollection } } })
    const before = useAppStore.getState()
    await before.dropCollection('target', 'shop', 'orders')
    const after = useAppStore.getState()
    expect(after.catalogs.target.collections).toBe(before.catalogs.target.collections)
    expect(after.catalogs.target.indexes).toBe(before.catalogs.target.indexes)
    expect(after.fieldCache).toBe(before.fieldCache)
    expect(after.catalogs.target.loading.size).toBe(0)
    expect(after.notifications).toHaveLength(1)
    expect(after.notifications[0]).toMatchObject({
      variant: 'error',
      source: 'catalog',
      title: expect.stringContaining('not authorized')
    })
  })

  it('does not recreate a catalog closed while deletion was in flight', async () => {
    let finish!: () => void
    vi.stubGlobal('window', {
      api: {
        catalog: {
          dropCollection: () =>
            new Promise<void>((resolve) => {
              finish = resolve
            })
        }
      }
    })
    const operation = useAppStore.getState().dropCollection('target', 'shop', 'orders')
    useAppStore.setState({ catalogs: {} })
    finish()
    await operation
    expect(useAppStore.getState().catalogs).toEqual({})
  })
})
