import { describe, expect, it } from 'vitest'
import { horizontalReorderTarget } from '@renderer/lib/useHorizontalReorder'

function slots(widths: number[]): { left: number; width: number }[] {
  let left = 56
  return widths.map((width) => {
    const slot = { left, width }
    left += width
    return slot
  })
}

describe('horizontalReorderTarget', () => {
  it('keeps the current position until a neighboring midpoint is crossed', () => {
    const items = slots([200, 200, 200])
    expect(horizontalReorderTarget(items, 1, -99)).toBe(1)
    expect(horizontalReorderTarget(items, 1, 99)).toBe(1)
    expect(horizontalReorderTarget(items, 1, -100)).toBe(0)
    expect(horizontalReorderTarget(items, 1, 100)).toBe(2)
  })

  it('can move a wide column past a narrow column in either direction', () => {
    expect(horizontalReorderTarget(slots([400, 60]), 0, 60)).toBe(1)
    expect(horizontalReorderTarget(slots([60, 400]), 1, -60)).toBe(0)
  })

  it('can move a narrow column past a wide column in either direction', () => {
    expect(horizontalReorderTarget(slots([60, 400]), 0, 400)).toBe(1)
    expect(horizontalReorderTarget(slots([400, 60]), 1, -400)).toBe(0)
  })

  it('crosses several unequal columns and can return to its starting slot', () => {
    const items = slots([200, 60, 400, 100])
    expect(horizontalReorderTarget(items, 0, 560)).toBe(3)
    expect(horizontalReorderTarget(items, 3, -660)).toBe(0)
    expect(horizontalReorderTarget(items, 0, 0)).toBe(0)
    expect(horizontalReorderTarget(items, 3, 0)).toBe(3)
  })
})
