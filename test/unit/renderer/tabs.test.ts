/**
 * Pure multi-tab helpers (lib/tabs): tab creation, immutable patch (identity
 * preservation for stable zustand selectors), close→next-active selection, and
 * the derived tab label.
 */
import { describe, it, expect } from 'vitest'
import { createTab, patchTab, pickActiveAfterClose, tabLabel } from '../../../src/renderer/src/lib/tabs'

describe('createTab', () => {
  it('makes an empty tab with the given id', () => {
    const t = createTab('a')
    expect(t).toMatchObject({
      id: 'a',
      code: '',
      activeDatabase: '',
      result: null,
      lastQuery: null,
      resultSkip: 0,
      running: false,
      runningExecId: null
    })
  })
  it('applies overrides', () => {
    expect(createTab('a', { code: 'db.x.find()' }).code).toBe('db.x.find()')
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
