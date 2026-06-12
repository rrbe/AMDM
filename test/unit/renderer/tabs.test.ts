/**
 * Pure multi-tab helpers (lib/tabs): tab creation, immutable patch (identity
 * preservation for stable zustand selectors), close→next-active selection, and
 * the derived tab label.
 */
import { describe, it, expect } from 'vitest'
import {
  activeResult,
  appendResult,
  closeResult,
  createTab,
  patchResult,
  patchTab,
  pickActiveAfterClose,
  pickFillTarget,
  resultTabLabel,
  tabLabel,
  type ResultTab
} from '../../../src/renderer/src/lib/tabs'
import type { ShellResult } from '../../../src/shared/types'

/** A minimal documents result for strip tests. */
function docsResult(collection?: string): ShellResult {
  return { kind: 'documents', data: [], count: 0, truncated: false, collection }
}

describe('createTab', () => {
  it('makes an empty tab with the given id', () => {
    const t = createTab('a')
    expect(t).toMatchObject({
      id: 'a',
      code: '',
      activeDatabase: '',
      pristine: true,
      results: [],
      activeResultId: null,
      resultSeq: 0,
      running: false,
      runningExecId: null
    })
  })
  it('applies overrides', () => {
    expect(createTab('a', { code: 'db.x.find()' }).code).toBe('db.x.find()')
  })
})

describe('pickFillTarget', () => {
  const SEED = { database: 'shop', code: 'db.orders.find({})' }

  it('focuses a tab that already holds exactly this fill', () => {
    const browse = createTab('b', { activeDatabase: 'shop', code: SEED.code })
    const edited = createTab('e', { code: 'db.users.find({ x: 1 })', pristine: false })
    expect(pickFillTarget([edited, browse], 'e', SEED)).toEqual({ focusId: 'b' })
  })
  it('matches the fill on database too, not just code', () => {
    const otherDb = createTab('b', { activeDatabase: 'archive', code: SEED.code, pristine: false })
    expect(pickFillTarget([otherDb], 'b', SEED)).toEqual({})
  })
  it('reuses the active tab while it is pristine with no results', () => {
    const blank = createTab('a')
    expect(pickFillTarget([blank], 'a', SEED)).toEqual({ reuseId: 'a' })
    // An untouched seed for another collection is equally disposable.
    const seeded = createTab('a', { activeDatabase: 'shop', code: 'db.users.find({})' })
    expect(pickFillTarget([seeded], 'a', SEED)).toEqual({ reuseId: 'a' })
  })
  it('never reuses a tab the user edited', () => {
    const edited = createTab('a', { code: 'db.users.find({ x: 1 })', pristine: false })
    expect(pickFillTarget([edited], 'a', SEED)).toEqual({})
  })
  it('never reuses a pristine tab that has results', () => {
    const ran = { ...createTab('a'), ...appendResult(createTab('a'), 'r1', docsResult(), null) }
    expect(pickFillTarget([ran], 'a', SEED)).toEqual({})
  })
  it('only ever reuses the ACTIVE tab', () => {
    const blank = createTab('a')
    const edited = createTab('e', { code: 'let x = 1', pristine: false })
    expect(pickFillTarget([blank, edited], 'e', SEED)).toEqual({})
  })
  it('skips the focus scan when no match is given (query/history loads)', () => {
    const browse = createTab('b', { activeDatabase: 'shop', code: SEED.code })
    const edited = createTab('e', { code: 'let x = 1', pristine: false })
    expect(pickFillTarget([browse, edited], 'e')).toEqual({})
  })
})

describe('patchTab', () => {
  it('updates only the target tab and keeps others by reference (stable refs)', () => {
    const a = createTab('a')
    const b = createTab('b')
    const next = patchTab([a, b], 'a', { code: 'x' })
    expect(next[0]).not.toBe(a) // patched → new object
    expect(next[0].code).toBe('x')
    expect(next[1]).toBe(b) // untouched → same reference (no needless re-render)
  })
  it('is a no-op shape when the id is absent', () => {
    const a = createTab('a')
    const next = patchTab([a], 'zzz', { code: 'x' })
    expect(next[0]).toBe(a)
  })
})

describe('pickActiveAfterClose', () => {
  const tabs = [createTab('a'), createTab('b'), createTab('c')]

  it('keeps the current active when a non-active tab is closed', () => {
    expect(pickActiveAfterClose(tabs, 'b', 'a')).toBe('b')
  })
  it('falls to the left neighbor when the active middle tab is closed', () => {
    expect(pickActiveAfterClose(tabs, 'b', 'b')).toBe('a')
  })
  it('falls to the right when the active first tab is closed', () => {
    expect(pickActiveAfterClose(tabs, 'a', 'a')).toBe('b')
  })
  it('returns the new last when the active last tab is closed', () => {
    expect(pickActiveAfterClose(tabs, 'c', 'c')).toBe('b')
  })
  it('returns undefined when the only tab is closed', () => {
    expect(pickActiveAfterClose([createTab('a')], 'a', 'a')).toBeUndefined()
  })
})

describe('tabLabel', () => {
  it('derives the targeted collection name', () => {
    expect(tabLabel(createTab('a', { code: 'db.lives.find({})' }), 0)).toBe('lives')
    expect(tabLabel(createTab('a', { code: 'db.getCollection("foo-bar").find()' }), 0)).toBe('foo-bar')
    expect(tabLabel(createTab('a', { code: 'db["x-y"].find()' }), 0)).toBe('x-y')
  })
  it('ignores db helper methods and falls back to a numbered label', () => {
    expect(tabLabel(createTab('a', { code: 'db.runCommand({ ping: 1 })' }), 0)).toBe('查询 1')
    expect(tabLabel(createTab('a', { code: '' }), 2)).toBe('查询 3')
  })
})

// ---------------------------------------------------------------------------
// Result strip helpers
// ---------------------------------------------------------------------------

const QUERY = { connectionId: 'c1', database: 'shop', code: 'db.orders.find({})' }

/** Build a tab carrying `n` results r1..rn via appendResult. */
function tabWithResults(n: number): ReturnType<typeof createTab> {
  let tab = createTab('t')
  for (let i = 1; i <= n; i++) {
    tab = { ...tab, ...appendResult(tab, `r${i}`, docsResult('orders'), QUERY) }
  }
  return tab
}

describe('appendResult', () => {
  it('appends a focused result tab with a monotonic seq and skip 0', () => {
    const tab = tabWithResults(2)
    expect(tab.results.map((r) => r.id)).toEqual(['r1', 'r2'])
    expect(tab.results.map((r) => r.seq)).toEqual([1, 2])
    expect(tab.results[1].skip).toBe(0)
    expect(tab.activeResultId).toBe('r2')
    expect(tab.resultSeq).toBe(2)
  })
  it('evicts the oldest beyond max without renumbering survivors', () => {
    let tab = tabWithResults(2)
    tab = { ...tab, ...appendResult(tab, 'r3', docsResult(), QUERY, 2) }
    expect(tab.results.map((r) => r.id)).toEqual(['r2', 'r3'])
    expect(tab.results.map((r) => r.seq)).toEqual([2, 3])
    expect(tab.activeResultId).toBe('r3')
  })
})

describe('patchResult', () => {
  it('patches only the target result and keeps others by reference', () => {
    const tab = tabWithResults(2)
    const [a] = tab.results
    const next = patchResult(tab, 'r2', { skip: 50 }).results!
    expect(next[0]).toBe(a)
    expect(next[1].skip).toBe(50)
  })
  it('is a no-op shape when the id is absent (tab closed mid-flight)', () => {
    const tab = tabWithResults(1)
    expect(patchResult(tab, 'gone', { skip: 50 }).results![0]).toBe(tab.results[0])
  })
})

describe('closeResult', () => {
  it('moves focus to the left neighbor when the active result closes', () => {
    const tab = tabWithResults(3)
    const patch = closeResult(tab, 'r3')
    expect(patch.results!.map((r) => r.id)).toEqual(['r1', 'r2'])
    expect(patch.activeResultId).toBe('r2')
  })
  it('keeps focus when a background result closes', () => {
    const tab = tabWithResults(3) // active: r3
    const patch = closeResult(tab, 'r1')
    expect(patch.activeResultId).toBe('r3')
  })
  it('clears focus when the last result closes', () => {
    const tab = tabWithResults(1)
    const patch = closeResult(tab, 'r1')
    expect(patch.results).toEqual([])
    expect(patch.activeResultId).toBeNull()
  })
  it('is a no-op shape for an unknown id', () => {
    expect(closeResult(tabWithResults(1), 'gone')).toEqual({})
  })
})

describe('activeResult', () => {
  it('returns the focused result tab, or null before any run', () => {
    const tab = tabWithResults(2)
    expect(activeResult(tab)?.id).toBe('r2')
    expect(activeResult(createTab('t'))).toBeNull()
  })
})

describe('resultTabLabel', () => {
  const rt = (result: ShellResult, seq = 1): ResultTab => ({ id: 'r', seq, result, query: null, skip: 0 })

  it('uses the target collection plus the run sequence', () => {
    expect(resultTabLabel(rt(docsResult('orders'), 3))).toBe('orders 3')
  })
  it('falls back to a kind-based label without a collection', () => {
    expect(resultTabLabel(rt(docsResult(), 2))).toBe('结果 2')
    expect(resultTabLabel(rt({ kind: 'explain', data: {} }, 4))).toBe('Explain 4')
    expect(resultTabLabel(rt({ kind: 'error', error: 'x', errorName: 'E' }, 5))).toBe('错误 5')
  })
})
