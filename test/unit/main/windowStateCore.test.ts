/**
 * Window-restore reconciliation: clamps saved size to [min, largest display],
 * falls back to centered defaults when missing/garbage, and drops the saved
 * position when the window would land off-screen (monitor unplugged / display
 * layout changed). Pure — no electron, no fs.
 */
import { describe, it, expect } from 'vitest'
import { resolveWindowBounds, type DisplayArea } from '../../../src/main/store/windowStateCore'

const C = { minWidth: 980, minHeight: 620, defaultWidth: 1440, defaultHeight: 920 }
// A single 1920×1080 display at the origin (work area, dock-trimmed height).
const PRIMARY: DisplayArea[] = [{ x: 0, y: 0, width: 1920, height: 1040 }]

describe('resolveWindowBounds', () => {
  it('falls back to centered defaults when nothing is saved', () => {
    expect(resolveWindowBounds(null, PRIMARY, C)).toEqual({ width: 1440, height: 920 })
  })

  it('restores a saved on-screen size + position verbatim', () => {
    const saved = { x: 100, y: 80, width: 1200, height: 800 }
    expect(resolveWindowBounds(saved, PRIMARY, C)).toEqual({
      width: 1200,
      height: 800,
      x: 100,
      y: 80
    })
  })

  it('drops an off-screen position but keeps the size (monitor unplugged)', () => {
    // Saved on a second monitor at x=2400 that no longer exists.
    const saved = { x: 2400, y: 200, width: 1200, height: 800 }
    expect(resolveWindowBounds(saved, PRIMARY, C)).toEqual({ width: 1200, height: 800 })
  })

  it('keeps the position when only a grabbable sliver overlaps a display', () => {
    // Window pushed mostly off the right edge but ~170px + full title bar remain.
    const saved = { x: 1750, y: 50, width: 1200, height: 800 }
    const r = resolveWindowBounds(saved, PRIMARY, C)
    expect(r.x).toBe(1750)
    expect(r.y).toBe(50)
  })

  it('drops the position when the visible overlap is too thin to grab', () => {
    // Only ~20px peek over the left edge — not reachable.
    const saved = { x: -1180, y: 50, width: 1200, height: 800 }
    expect(resolveWindowBounds(saved, PRIMARY, C)).toEqual({ width: 1200, height: 800 })
  })

  it('clamps a saved size below the minimum up to the floor', () => {
    const saved = { x: 0, y: 0, width: 400, height: 300 }
    const r = resolveWindowBounds(saved, PRIMARY, C)
    expect(r.width).toBe(980)
    expect(r.height).toBe(620)
  })

  it('caps a saved size larger than the largest display (external monitor gone)', () => {
    const saved = { x: 0, y: 0, width: 3000, height: 1600 }
    const r = resolveWindowBounds(saved, PRIMARY, C)
    expect(r.width).toBe(1920)
    expect(r.height).toBe(1040)
  })

  it('ignores garbage numbers and uses defaults', () => {
    const saved = { x: NaN, y: 10, width: Infinity, height: -5 }
    expect(resolveWindowBounds(saved, PRIMARY, C)).toEqual({ width: 1440, height: 920 })
  })

  it('restores onto a secondary display to the right', () => {
    const displays: DisplayArea[] = [
      { x: 0, y: 0, width: 1920, height: 1040 },
      { x: 1920, y: 0, width: 2560, height: 1400 }
    ]
    const saved = { x: 2000, y: 100, width: 1600, height: 1000 }
    expect(resolveWindowBounds(saved, displays, C)).toEqual({
      width: 1600,
      height: 1000,
      x: 2000,
      y: 100
    })
  })
})
