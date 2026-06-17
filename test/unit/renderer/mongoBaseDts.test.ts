/**
 * Runtime collection-declaration generation for the TS-service completer.
 * (The base d.ts string and the worker/service are exercised manually in-app.)
 */
import { describe, it, expect } from 'vitest'
import { buildCollectionDecls } from '@renderer/lib/tsAutocomplete/mongoBaseDts'

describe('buildCollectionDecls', () => {
  it('types identifier collections as Collection members of Database', () => {
    const d = buildCollectionDecls(['users', 'orders'])
    expect(d).toContain('interface Database {')
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
