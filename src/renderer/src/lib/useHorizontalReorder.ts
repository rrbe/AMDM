import { useEffect, type RefObject } from 'react'

interface ReorderOptions {
  itemSelector: string
  idAttribute: string
  ignoreSelector: string
  sortingClass: string
  draggingClass: string
}

/** Pointer sorting shared by tab strips and resizable table columns. */
export function useHorizontalReorder(
  stripRef: RefObject<HTMLDivElement | null>,
  order: string,
  options: ReorderOptions,
  onMove: (sourceId: string, targetId: string) => void,
  onSelect?: (id: string) => void,
  onDragEnd?: () => void
): void {
  useEffect(() => {
    const strip = stripRef.current
    if (!strip) return
    let drag: {
      pointerId: number
      source: number
      target: number
      startX: number
      x: number
      y: number
      scrollLeft: number
      started: boolean
      slots: {
        element: HTMLElement
        id: string
        left: number
        width: number
      }[]
    } | null = null
    let frame = 0
    let previousTime = 0
    let suppressClick = false

    const finish = (commit: boolean): void => {
      if (!drag) return
      const current = drag
      drag = null
      cancelAnimationFrame(frame)
      strip.classList.remove(options.sortingClass)
      for (const [index, { element }] of current.slots.entries()) {
        element.classList.remove(options.draggingClass)
        element.style.removeProperty('transform')
        strip.style.removeProperty(`--reorder-offset-${index}`)
        strip.style.removeProperty(`--reorder-z-${index}`)
        strip.style.removeProperty(`--reorder-duration-${index}`)
      }
      if (strip.hasPointerCapture(current.pointerId)) strip.releasePointerCapture(current.pointerId)
      if (current.started) onDragEnd?.()
      if (commit && current.started) {
        onMove(current.slots[current.source].id, current.slots[current.target].id)
      }
    }

    const paint = (time: number): void => {
      if (!drag?.started) return
      const { slots, source } = drag
      const bounds = strip.getBoundingClientRect()
      const headerBounds = slots[source].element.parentElement!.getBoundingClientRect()
      const elapsed = previousTime ? Math.min(time - previousTime, 32) : 16
      previousTime = time
      // Keep scrolling even when the pointer rests at an overflowing strip's edge.
      if (drag.y >= headerBounds.top - 32 && drag.y <= headerBounds.bottom + 32) {
        const edge = 40
        const speed =
          drag.x < bounds.left + edge
            ? -Math.min(1, (bounds.left + edge - drag.x) / edge)
            : drag.x > bounds.right - edge
              ? Math.min(1, (drag.x - bounds.right + edge) / edge)
              : 0
        strip.scrollLeft += speed * elapsed * 0.7
      }
      const sourceSlot = slots[source]
      const gap = slots.length > 1 ? slots[1].left - slots[0].left - slots[0].width : 0
      sourceSlot.element.classList.add(options.draggingClass)
      const last = slots[slots.length - 1]
      const left = Math.max(
        slots[0].left,
        Math.min(
          last.left + last.width - sourceSlot.width,
          sourceSlot.left + drag.x - drag.startX + strip.scrollLeft - drag.scrollLeft
        )
      )
      const target = horizontalReorderTarget(slots, source, left - sourceSlot.left)
      drag.target = target
      for (let i = 0; i < slots.length; i++) {
        const offset =
          i === source
            ? left - sourceSlot.left
            : i > source && i <= target
              ? -sourceSlot.width - gap
              : i < source && i >= target
                ? sourceSlot.width + gap
                : 0
        const transform = `translateX(${offset}px)`
        slots[i].element.style.transform = transform
        // Virtualized body cells inherit the same preview without React renders.
        strip.style.setProperty(`--reorder-offset-${i}`, transform)
        strip.style.setProperty(`--reorder-z-${i}`, i === source ? '1' : '0')
        strip.style.setProperty(`--reorder-duration-${i}`, i === source ? '0ms' : 'var(--motion-fast)')
      }
      frame = requestAnimationFrame(paint)
    }

    const down = (event: PointerEvent): void => {
      suppressClick = false
      if (event.button !== 0 || !event.isPrimary || !(event.target instanceof Element)) return
      if (event.target.closest(options.ignoreSelector)) return
      const element = event.target.closest<HTMLElement>(options.itemSelector)
      if (!element || !strip.contains(element)) return
      const slots = Array.from(strip.querySelectorAll<HTMLElement>(options.itemSelector)).map((element) => {
        const bounds = element.getBoundingClientRect()
        return {
          element,
          id: element.getAttribute(options.idAttribute)!,
          left: bounds.left,
          width: bounds.width
        }
      })
      const source = slots.findIndex((slot) => slot.element === element)
      drag = {
        pointerId: event.pointerId,
        source,
        target: source,
        startX: event.clientX,
        x: event.clientX,
        y: event.clientY,
        scrollLeft: strip.scrollLeft,
        started: false,
        slots
      }
    }
    const move = (event: PointerEvent): void => {
      if (!drag || event.pointerId !== drag.pointerId) return
      drag.x = event.clientX
      drag.y = event.clientY
      if (!drag.started) {
        if (Math.abs(drag.x - drag.startX) < 5) return
        drag.started = true
        suppressClick = true
        strip.setPointerCapture(event.pointerId)
        strip.classList.add(options.sortingClass)
        drag.slots[drag.source].element.classList.add(options.draggingClass)
        onSelect?.(drag.slots[drag.source].id)
        previousTime = 0
        frame = requestAnimationFrame(paint)
      }
      event.preventDefault()
    }
    const up = (event: PointerEvent): void => {
      if (event.pointerId !== drag?.pointerId) return
      // Apply the final pointer position even if release arrives before the next frame.
      drag.x = event.clientX
      drag.y = event.clientY
      cancelAnimationFrame(frame)
      paint(performance.now())
      finish(true)
    }
    const cancel = (): void => finish(false)
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && drag?.started) {
        event.preventDefault()
        event.stopPropagation()
        cancel()
      }
    }
    const click = (event: MouseEvent): void => {
      if (suppressClick) {
        suppressClick = false
        event.preventDefault()
        event.stopPropagation()
      }
    }
    strip.addEventListener('pointerdown', down)
    strip.addEventListener('lostpointercapture', cancel)
    strip.addEventListener('click', click, true)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('blur', cancel)
    window.addEventListener('keydown', key, true)
    return () => {
      cancel()
      strip.removeEventListener('pointerdown', down)
      strip.removeEventListener('lostpointercapture', cancel)
      strip.removeEventListener('click', click, true)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('blur', cancel)
      window.removeEventListener('keydown', key, true)
    }
  }, [stripRef, order, options, onSelect, onMove, onDragEnd])
}

/** Cross the midpoint of each displaced item, including unequal-width columns. */
export function horizontalReorderTarget(
  slots: readonly { left: number; width: number }[],
  source: number,
  delta: number
): number {
  const origin = slots[source]
  let target = source
  for (let i = 0; i < slots.length; i++) {
    const midpoint = slots[i].left + slots[i].width / 2
    if (i < source && origin.left + delta <= midpoint) return i
    if (i > source && origin.left + origin.width + delta >= midpoint) target = i
  }
  return target
}
