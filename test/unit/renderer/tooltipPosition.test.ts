import { describe, expect, it } from 'vitest'
import { computeTooltipPosition } from '@renderer/lib/tooltipPosition'

const viewport = { width: 800, height: 600 }
const tooltip = { width: 160, height: 48 }
const gap = 6
const margin = 8

describe('computeTooltipPosition', () => {
  it('prefers the top so the tooltip does not cover row text', () => {
    expect(
      computeTooltipPosition(
        { top: 200, right: 340, bottom: 224, left: 300, width: 40, height: 24 },
        tooltip,
        viewport,
        gap,
        margin
      )
    ).toEqual({ top: 146, left: 240, placement: 'top' })
  })

  it('falls back to the bottom near the top edge', () => {
    expect(
      computeTooltipPosition(
        { top: 20, right: 340, bottom: 44, left: 300, width: 40, height: 24 },
        tooltip,
        viewport,
        gap,
        margin
      )
    ).toEqual({ top: 50, left: 240, placement: 'bottom' })
  })

  it('uses the right when neither vertical side has enough room', () => {
    expect(
      computeTooltipPosition(
        { top: 88, right: 140, bottom: 112, left: 100, width: 40, height: 24 },
        { width: 160, height: 100 },
        { width: 800, height: 200 },
        gap,
        margin
      )
    ).toEqual({ top: 50, left: 146, placement: 'right' })
  })

  it('uses the left when the other three sides are constrained', () => {
    expect(
      computeTooltipPosition(
        { top: 88, right: 700, bottom: 112, left: 660, width: 40, height: 24 },
        { width: 160, height: 100 },
        { width: 800, height: 200 },
        gap,
        margin
      )
    ).toEqual({ top: 50, left: 494, placement: 'left' })
  })
})
