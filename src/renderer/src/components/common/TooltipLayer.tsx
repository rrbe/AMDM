import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * A single, app-wide styled tooltip — the lightweight replacement for native
 * `title=` (which is slow to appear, unstyled, and ignores dark mode). Mount it
 * once at the app root; any element carrying a non-empty `data-tip="…"` gets a
 * delayed, themed tooltip on hover/focus. `data-tip-overflow` limits it to
 * content that is actually clipped.
 *
 * Event-delegation (one set of document listeners) rather than a wrapper
 * component per trigger, so adopting it is just renaming `title` → `data-tip`.
 * The bubble is portaled to <body> so `overflow:hidden` ancestors never clip it,
 * and positioned from the trigger's live rect (measured, then clamped on-screen).
 */
const SHOW_DELAY = 700
const GAP = 6
const MARGIN = 8

interface Active {
  text: string
  rect: DOMRect
}

export function TooltipLayer(): JSX.Element | null {
  const [active, setActive] = useState<Active | null>(null)
  const [style, setStyle] = useState<{ top: number; left: number; visible: boolean }>({
    top: 0,
    left: 0,
    visible: false
  })
  const boxRef = useRef<HTMLDivElement | null>(null)
  // Mutable hover state kept off React to avoid re-render churn on every mousemove.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const current = useRef<Element | null>(null)

  useEffect(() => {
    const clear = (): void => {
      if (timer.current) {
        clearTimeout(timer.current)
        timer.current = null
      }
      current.current = null
      setActive(null)
    }

    const tipOf = (el: Element | null): string => {
      const text = el?.getAttribute('data-tip')?.trim() ?? ''
      if (
        el?.hasAttribute('data-tip-overflow') &&
        el.scrollWidth <= el.clientWidth &&
        el.scrollHeight <= el.clientHeight
      )
        return ''
      return text
    }

    const onOver = (e: MouseEvent): void => {
      const node = e.target as Node | null
      // The tooltip itself is interactive so its text can be selected/copied.
      if (node && boxRef.current?.contains(node)) return
      const el = (e.target as Element | null)?.closest('[data-tip]') ?? null
      if (el === current.current) return
      // Moved to a different (or no) trigger: cancel any pending show first.
      if (timer.current) {
        clearTimeout(timer.current)
        timer.current = null
      }
      const text = tipOf(el)
      if (!el || !text) {
        current.current = null
        setActive(null)
        return
      }
      current.current = el
      setActive(null) // hide the old one immediately; the new one waits out the delay
      timer.current = setTimeout(() => {
        // Re-read the rect at show time (the trigger may have scrolled/moved).
        setActive({ text, rect: el.getBoundingClientRect() })
        timer.current = null
      }, SHOW_DELAY)
    }

    const onOut = (e: MouseEvent): void => {
      const from = e.target as Node | null
      const to = e.relatedTarget as Node | null
      if (from && boxRef.current?.contains(from)) {
        if (e.buttons === 0 && (!to || (!boxRef.current?.contains(to) && !current.current?.contains(to)))) clear()
        return
      }
      const el = (e.target as Element | null)?.closest('[data-tip]') ?? null
      if (!el || el !== current.current) return
      // Ignore moves between descendants of the trigger or into the tooltip.
      if (to && (el.contains(to) || boxRef.current?.contains(to))) return
      clear()
    }

    const onMouseDown = (e: MouseEvent): void => {
      const node = e.target as Node | null
      if (node && boxRef.current?.contains(node)) return
      clear()
    }

    document.addEventListener('mouseover', onOver)
    document.addEventListener('mouseout', onOut)
    // Pointer movement, scrolling, or focus loss invalidates the anchored position.
    document.addEventListener('mousedown', onMouseDown)
    window.addEventListener('scroll', clear, true)
    window.addEventListener('blur', clear)
    return () => {
      document.removeEventListener('mouseover', onOver)
      document.removeEventListener('mouseout', onOut)
      document.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('scroll', clear, true)
      window.removeEventListener('blur', clear)
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  // Place the bubble to the right, falling back to the left at the viewport edge.
  useLayoutEffect(() => {
    if (!active || !boxRef.current) {
      setStyle((s) => (s.visible ? { ...s, visible: false } : s))
      return
    }
    const box = boxRef.current.getBoundingClientRect()
    const { rect } = active
    const top = Math.max(
      MARGIN,
      Math.min(rect.top + rect.height / 2 - box.height / 2, window.innerHeight - box.height - MARGIN)
    )
    const right = rect.right + GAP
    const left =
      right + box.width <= window.innerWidth - MARGIN
        ? right
        : Math.max(MARGIN, rect.left - box.width - GAP)
    setStyle({ top, left, visible: true })
  }, [active])

  if (!active) return null
  return createPortal(
    <div
      ref={boxRef}
      className="app-tooltip"
      role="tooltip"
      style={{ top: style.top, left: style.left, visibility: style.visible ? 'visible' : 'hidden' }}
    >
      {active.text}
    </div>,
    document.body
  )
}
