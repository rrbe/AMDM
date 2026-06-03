import { useEffect, useRef } from 'react'

interface ResizeHandleProps {
  /** 'x' resizes width (a vertical bar, col-resize); 'y' resizes height (a horizontal bar). */
  axis: 'x' | 'y'
  /** CSS custom property on :root that drives the resized element's size. */
  cssVar: string
  /** Persisted size in px — the drag baseline and the source of truth at rest. */
  value: number
  /** Lower clamp in px. */
  min: number
  /** Upper clamp in px, evaluated live (so it can track window size). */
  getMax: () => number
  /** Called once on release with the final size; the parent persists it. */
  onCommit: (px: number) => void
  /** 'resize-handle--col' | 'resize-handle--row'. */
  className: string
  ariaLabel: string
}

/**
 * A draggable divider that resizes a sibling panel by writing a px value into a
 * :root CSS variable. The drag mutates the variable IMPERATIVELY (no React
 * re-render per frame — perf rule ADR-0004), and only commits to settings on
 * pointer-up, so we never thrash settings.json mid-drag. At rest the variable
 * is kept in sync with the persisted `value` prop.
 */
export function ResizeHandle({
  axis,
  cssVar,
  value,
  min,
  getMax,
  onCommit,
  className,
  ariaLabel
}: ResizeHandleProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  // Active-drag bookkeeping; null when not dragging. `last` holds the latest
  // clamped px so pointer-up can commit without re-reading the DOM.
  const drag = useRef<{ start: number; base: number; last: number } | null>(null)

  // Keep the CSS variable in sync with the persisted value while at rest. Guard
  // against clobbering a live drag (the commit re-renders us with the same value).
  useEffect(() => {
    if (!drag.current) document.documentElement.style.setProperty(cssVar, `${value}px`)
  }, [cssVar, value])

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    e.preventDefault()
    ref.current?.setPointerCapture(e.pointerId)
    drag.current = { start: axis === 'x' ? e.clientX : e.clientY, base: value, last: value }
    ref.current?.classList.add('dragging')
    document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>): void {
    const d = drag.current
    if (!d) return
    const pos = axis === 'x' ? e.clientX : e.clientY
    const next = Math.min(Math.max(d.base + (pos - d.start), min), getMax())
    d.last = next
    document.documentElement.style.setProperty(cssVar, `${next}px`)
  }

  function endDrag(e: React.PointerEvent<HTMLDivElement>): void {
    const d = drag.current
    if (!d) return
    ref.current?.releasePointerCapture(e.pointerId)
    ref.current?.classList.remove('dragging')
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    drag.current = null
    const px = Math.round(d.last)
    if (px !== d.base) onCommit(px)
  }

  return (
    <div
      ref={ref}
      className={`resize-handle ${className}`}
      role="separator"
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-label={ariaLabel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    />
  )
}
