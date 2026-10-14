/**
 * Runtime collection-declaration generation for the TS-service completer.
 * Official declarations are exercised through the same service used by the worker.
 */
import { describe, it, expect } from 'vitest'
import { buildCollectionDecls } from '@renderer/lib/tsAutocomplete/mongoBaseDts'
import { complete, setFile } from '@renderer/lib/tsAutocomplete/tsService'

describe('buildCollectionDecls', () => {
  it('types identifier collections as Collection members of Database', () => {
    const d = buildCollectionDecls(['users', 'orders'])
    expect(d).toContain('interface AmdmCollections {')
    expect(d).toContain('users: Collection;')
    expect(d).toContain('orders: Collection;')
  })

  it('skips non-identifier names and reserved db member names', () => {
    const d = buildCollectionDecls(['lives', 'system.views', '123bad', 'stats', 'getName'])
    expect(d).toContain('lives: Collection;')
    expect(d).not.toContain('system.views')
    expect(d).not.toContain('123bad')
    expect(d).not.toContain('stats:') // reserved → Database.stats()
    expect(d).not.toContain('getName')
  })

  it('returns empty string when nothing qualifies (no empty interface to reparse)', () => {
    expect(buildCollectionDecls([])).toBe('')
    expect(buildCollectionDecls(['a.b', 'getName'])).toBe('')
  })
})

describe('official Mongosh completion', () => {
  it.each([
    ['db.', 'getMongo'],
    ['db.getCollection("items").find().', 'projection'],
    ['db.getMongo().startSession().', 'withTransaction'],
    ['rs.', 'status'],
    ['sh.', 'status'],
    ['ObjectId().', 'toHexString'],
    ['driverDb.collection("items").', 'insertOne'],
    ['db.getSiblingDB("other").getCollection("items").', 'getIndexes']
  ])('completes %s with %s', (code, expected) => {
    expect(complete(code, code.length).entries.map((entry) => entry.name)).toContain(expected)
  })
  it('combines live collections with official chain types', () => {
    setFile('/decls.d.ts', buildCollectionDecls(['items']))
    const code = 'db.items.find().'
    const names = complete(code, code.length).entries.map((entry) => entry.name)
    expect(names).toContain('projection')
    expect(names).not.toContain('project')
    expect(names.some((name) => name.startsWith('_'))).toBe(false)
  })
  it('does not expose Node process APIs as Shell globals', () => {
    const code = 'process.'
    expect(complete(code, code.length).entries).toEqual([])
  })
})
