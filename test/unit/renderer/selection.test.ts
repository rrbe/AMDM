/**
 * Row/document multi-selection model (extracted from TableView/TreeView).
 */
import { describe, it, expect } from 'vitest'
import {
  computeSelection,
  computeVisibleSelection,
  selectedIndexesInOrder,
  type SelectionMods
} from '@renderer/lib/selection'

const NONE: SelectionMods = { shift: false, meta: false, ctrl: false }
const SHIFT: SelectionMods = { shift: true, meta: false, ctrl: false }
const META: SelectionMods = { shift: false, meta: true, ctrl: false }
const CTRL: SelectionMods = { shift: false, meta: false, ctrl: true }

const set = (...xs: number[]): Set<number> => new Set(xs)

describe('plain click', () => {
  it('selects just the clicked index and anchors it', () => {
    expect(computeSelection(set(1, 2, 3), 5, 2, NONE)).toEqual({ selection: set(5), anchor: 5 })
  })
})

describe('Shift+click range', () => {
  it('selects the contiguous range from the anchor (forward)', () => {
    expect(computeSelection(set(), 4, 1, SHIFT)).toEqual({ selection: set(1, 2, 3, 4), anchor: 1 })
  })
  it('selects the range when clicking before the anchor (reverse)', () => {
    expect(computeSelection(set(), 1, 4, SHIFT)).toEqual({ selection: set(1, 2, 3, 4), anchor: 4 })
  })
  it('keeps the anchor put so the range can be re-extended', () => {
    const first = computeSelection(set(), 3, 1, SHIFT)
    expect(first.anchor).toBe(1)
    expect(computeSelection(first.selection, 5, first.anchor, SHIFT).selection).toEqual(
      set(1, 2, 3, 4, 5)
    )
  })
  it('falls back to a plain select when there is no anchor', () => {
    expect(computeSelection(set(2), 5, null, SHIFT)).toEqual({ selection: set(5), anchor: 5 })
  })
})

describe('⌘/Ctrl toggle', () => {
  it('adds an index not yet selected and re-anchors', () => {
    expect(computeSelection(set(1, 2), 5, 1, META)).toEqual({ selection: set(1, 2, 5), anchor: 5 })
  })
  it('removes an already-selected index', () => {
    expect(computeSelection(set(1, 2, 5), 2, 1, CTRL)).toEqual({ selection: set(1, 5), anchor: 2 })
  })
})

describe('immutability', () => {
  it('never mutates the incoming set (returns a fresh Set)', () => {
    const prev = set(1, 2)
    const r = computeSelection(prev, 3, 1, META)
    expect(prev).toEqual(set(1, 2)) // unchanged
    expect(r.selection).not.toBe(prev) // new reference
  })
})

describe('reordered visible rows', () => {
  const order = [3, 1, 4, 0, 2]

  it('returns source indexes for a plain click and modifier toggle', () => {
    const first = computeVisibleSelection(set(), 1, null, order, NONE)
    expect(first).toEqual({ selection: set(1), anchor: 1 })
    expect(computeVisibleSelection(first.selection, 3, first.anchor, order, META)).toEqual({
      selection: set(1, 0),
      anchor: 0
    })
  })

  it('extends Shift selection across the visible range, not the source-index range', () => {
    expect(computeVisibleSelection(set(1), 4, 1, order, SHIFT)).toEqual({
      selection: set(1, 4, 0, 2),
      anchor: 1
    })
  })

  it('drops stale source indexes that are absent from the visible result', () => {
    expect(computeVisibleSelection(set(99, 3), 0, 3, order, META)).toEqual({
      selection: set(),
      anchor: 3
    })
  })

  it('exposes selected source indexes in visible order for export consumers', () => {
    expect(selectedIndexesInOrder(set(0, 1, 3), order)).toEqual([3, 1, 0])
  })
})
