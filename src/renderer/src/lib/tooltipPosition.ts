export type TooltipPlacement = 'top' | 'bottom' | 'right' | 'left'

interface Rect {
  top: number
  right: number
  bottom: number
  left: number
  width: number
  height: number
}

interface Size {
  width: number
  height: number
}

interface Viewport {
  width: number
  height: number
}

export interface TooltipPosition {
  top: number
  left: number
  placement: TooltipPlacement
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(value, max))

export function computeTooltipPosition(
  trigger: Rect,
  tooltip: Size,
  viewport: Viewport,
  gap: number,
  margin: number
): TooltipPosition {
  const available: Record<TooltipPlacement, number> = {
    top: trigger.top - gap - margin,
    bottom: viewport.height - trigger.bottom - gap - margin,
    right: viewport.width - trigger.right - gap - margin,
    left: trigger.left - gap - margin
  }
  const required: Record<TooltipPlacement, number> = {
    top: tooltip.height,
    bottom: tooltip.height,
    right: tooltip.width,
    left: tooltip.width
  }
  const priority: TooltipPlacement[] = ['top', 'bottom', 'right', 'left']
  const placement =
    priority.find((side) => available[side] >= required[side]) ??
    priority.reduce((best, side) => (available[side] > available[best] ? side : best))
  const maxLeft = Math.max(margin, viewport.width - tooltip.width - margin)
  const maxTop = Math.max(margin, viewport.height - tooltip.height - margin)
  const centeredLeft = clamp(trigger.left + trigger.width / 2 - tooltip.width / 2, margin, maxLeft)
  const centeredTop = clamp(trigger.top + trigger.height / 2 - tooltip.height / 2, margin, maxTop)

  switch (placement) {
    case 'top':
      return {
        top: clamp(trigger.top - tooltip.height - gap, margin, maxTop),
        left: centeredLeft,
        placement
      }
    case 'bottom':
      return {
        top: clamp(trigger.bottom + gap, margin, maxTop),
        left: centeredLeft,
        placement
      }
    case 'right':
      return {
        top: centeredTop,
        left: clamp(trigger.right + gap, margin, maxLeft),
        placement
      }
    case 'left':
      return {
        top: centeredTop,
        left: clamp(trigger.left - tooltip.width - gap, margin, maxLeft),
        placement
      }
  }
}
