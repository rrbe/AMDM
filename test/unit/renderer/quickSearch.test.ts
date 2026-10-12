import { describe, expect, it } from 'vitest'
import { QuickSearchIndex } from '../../../src/renderer/src/lib/quickSearch/engine'
import {
  SEARCH_GROUPS,
  SEARCH_PAGE_SIZE,
  searchId,
  type SearchDocument,
  type SearchRequest
} from '../../../src/renderer/src/lib/quickSearch/types'
import { parseSearchVisits } from '../../../src/renderer/src/lib/quickSearch/visits'

const request = (patch: Partial<SearchRequest> = {}): SearchRequest => ({
  query: '',
  scope: 'all',
  connectionId: 'c1',
  visits: [],
  ...patch
})
const doc = (id: string, patch: Partial<SearchDocument> = {}): SearchDocument => ({
  id,
  group: 'queries',
  label: 'orders',
  detail: 'shop',
  ...patch
})

describe('quick search', () => {
  it('limits each overview group independently and counts all matches', async () => {
    const index = new QuickSearchIndex()
    await index.sync(
      SEARCH_GROUPS.flatMap((group) =>
        Array.from({ length: 7 }, (_, n) => doc(`${group}:${n}`, { group, code: 'db.orders.find()' }))
      ),
      []
    )
    const result = await index.search(request({ query: 'orders' }))
    expect(result?.hits).toHaveLength(15)
    for (const group of SEARCH_GROUPS) expect(result?.totals[group]).toBe(7)
  })

  it('ranks exact names before prefixes, context, code, and fuzzy matches', async () => {
    const index = new QuickSearchIndex()
    await index.sync(
      [
        doc('code', { label: 'query', code: 'db.orders.find()' }),
        doc('typo', { label: 'ordres' }),
        doc('prefix', { label: 'orders_archive' }),
        doc('exact-other', { connectionId: 'c2' }),
        doc('exact-current', { connectionId: 'c1' })
      ],
      []
    )
    const result = await index.search(request({ query: 'orders', scope: 'queries' }))
    expect(result?.hits.map((hit) => hit.id)).toEqual([
      'exact-current',
      'exact-other',
      'prefix',
      'code',
      'typo'
    ])
  })

  it('keeps long code literal, searches beyond the preview, and never fuzzes history code titles', async () => {
    const index = new QuickSearchIndex()
    await index.sync(
      [
        doc('long', { label: 'query', code: `${' '.repeat(50000)}TARGET_FIELD` }),
        doc('history', { group: 'history', label: 'db.orders.find()', code: 'db.orders.find()' })
      ],
      []
    )
    const result = await index.search(request({ query: 'target_field', scope: 'queries' }))
    expect(result?.hits[0].preview).toContain('TARGET_FIELD')
    expect(result?.hits[0].preview.length).toBeLessThan(185)
    expect((await index.search(request({ query: 'target_filed', scope: 'queries' })))?.hits).toEqual([])
    expect((await index.search(request({ query: 'ordres', scope: 'history' })))?.hits).toEqual([])
  })

  it('paginates all matches without duplicates or truncation and applies index removals', async () => {
    const index = new QuickSearchIndex()
    await index.sync(
      Array.from({ length: 257 }, (_, n) => doc(`q${n}`)),
      []
    )
    const ids: string[] = []
    let after: SearchRequest['after']
    for (let page = 0; page < 3; page++) {
      const result = await index.search(request({ query: 'orders', scope: 'queries', after }))
      expect(result?.hits.length).toBeLessThanOrEqual(SEARCH_PAGE_SIZE)
      expect(result?.more).toBe(page < 2)
      ids.push(...result!.hits.map((hit) => hit.id))
      after = result!.hits.at(-1)!.rank
    }
    expect(new Set(ids).size).toBe(257)
    await index.sync([doc('q0', { label: 'products' })], ids.slice(1))
    expect((await index.search(request({ query: 'orders', scope: 'queries' })))?.hits).toEqual([])
  })

  it('shows only visited items in the empty overview and resolves merged-history member visits', async () => {
    const index = new QuickSearchIndex()
    await index.sync(
      [doc('unvisited'), doc('recent'), doc('merged', { group: 'history', visitIds: ['older'] })],
      []
    )
    const result = await index.search(
      request({
        visits: [
          { id: 'recent', at: 1 },
          { id: 'older', at: 2 }
        ]
      })
    )
    expect(result?.hits.map((hit) => hit.id)).toEqual(['recent', 'merged'])
    expect((await index.search(request({ scope: 'queries' })))?.hits).toHaveLength(2)
  })

  it('abandons superseded searches between chunks', async () => {
    const index = new QuickSearchIndex()
    await index.sync(
      Array.from({ length: 700 }, (_, n) => doc(`q${n}`)),
      []
    )
    let checks = 0
    expect(await index.search(request({ query: 'orders' }), () => ++checks > 1)).toBeNull()
  })

  it('prioritizes actual visits over an unvisited resource update time', async () => {
    const index = new QuickSearchIndex()
    await index.sync([doc('visited', { updatedAt: 1 }), doc('updated', { updatedAt: 100 })], [])
    const result = await index.search(request({ scope: 'queries', visits: [{ id: 'visited', at: 5 }] }))
    expect(result?.hits.map((hit) => hit.id)).toEqual(['visited', 'updated'])
  })

  it('bounds and validates persisted visit metadata', () => {
    const values = Array.from({ length: 80 }, (_, n) => ({ id: searchId('queries', String(n)), at: n }))
    const restored = parseSearchVisits(JSON.stringify([...values, values[0], { id: 1, at: 'invalid' }]))
    expect(restored).toHaveLength(50)
    expect(restored[0]).toEqual(values[79])
    expect(restored.at(-1)).toEqual(values[30])
  })
})
