import { describe, expect, it } from 'vitest'
import { catalogSearchSnapshot, createCatalogSearch } from '../../../src/renderer/src/lib/catalogSearch'

describe('catalog matching and highlights', () => {
  const search = createCatalogSearch([
    { id: 'orders', text: 'orders' },
    { id: 'archive', text: 'archived_orders' },
    { id: 'products', text: 'products' },
    { id: 'host', text: 'Production', detail: 'mongo.example.com:27017' },
    { id: 'chinese', text: '订单记录' },
    { id: 'repeated', text: 'test_test' }
  ])

  it('highlights prefix and substring matches at their original positions', () => {
    const matches = search(' ORD ')
    expect([...matches.keys()]).toEqual(['orders', 'archive'])
    expect(matches.get('orders')).toEqual({ text: [[0, 2]], detail: [], approximate: false })
    expect(matches.get('archive')?.text).toEqual([[9, 11]])
  })

  it('keeps short searches literal and supports Chinese, repeated matches, and hosts', () => {
    expect(search('prd').size).toBe(0)
    expect(search('订单').get('chinese')?.text).toEqual([[0, 1]])
    expect(search('test').get('repeated')?.text).toEqual([
      [0, 3],
      [5, 8]
    ])
    expect(search('27017').get('host')).toEqual({ text: [], detail: [[18, 22]], approximate: false })
  })

  it('tolerates misspellings and transpositions on longer searches', () => {
    expect(search('ordees').get('orders')?.approximate).toBe(true)
    expect(search('ordres').get('archive')?.approximate).toBe(true)
    expect(search('orders').get('orders')?.approximate).toBe(false)
    expect(search('zzzxxx').size).toBe(0)
    expect(search('   ').size).toBe(0)
  })

  it('snapshots only namespace names and collection types', () => {
    const snapshot = catalogSearchSnapshot({
      databases: [{ name: 'shop', sizeOnDisk: 999 }],
      collections: { shop: [{ name: 'orders', type: 'collection', estimatedCount: 42 }], pending: undefined },
      indexes: { 'shop/orders': [{ name: '_id_', key: { _id: 1 } }] },
      users: {},
      expanded: new Set(['c1:db:shop']),
      loading: new Set(['c1:coll:shop/orders'])
    })
    expect(snapshot).toEqual({
      databases: [{ name: 'shop' }],
      collections: { shop: [{ name: 'orders', type: 'collection' }] }
    })
  })
})
