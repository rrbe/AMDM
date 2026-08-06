import { describe, expect, it } from 'vitest'
import { clampModalPosition } from '@renderer/lib/modalPosition'

describe('clampModalPosition', () => {
  it('keeps the whole modal within the viewport margin', () => {
    expect(clampModalPosition(100, 80, 300, 200, 800, 600)).toEqual({
      left: 100,
      top: 80
    })
    expect(clampModalPosition(-20, -30, 300, 200, 800, 600)).toEqual({
      left: 8,
      top: 8
    })
    expect(clampModalPosition(700, 500, 300, 200, 800, 600)).toEqual({
      left: 492,
      top: 392
    })
  })
})
