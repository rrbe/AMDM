import { useEffect, type RefObject } from 'react'

/** Shared pointer sorting for the fixed-width Query and Result tab strips. */
export function useTabReorder(
  stripRef: RefObject<HTMLDivElement | null>,
  tabs: readonly { id: string }[],
  onSelect: (id: string) => void,
  onMove: (sourceId: string, targetId: string) => void
): void {
  // Updating query text or receiving a result must not interrupt a query-tab drag.
  const order = JSON.stringify(tabs.map((tab) => tab.id))

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
      strip.classList.remove('tab-strip-sorting')
      for (const { element } of current.slots) {
        element.classList.remove('document-tab-dragging')
        element.style.removeProperty('transform')
      }
      if (strip.hasPointerCapture(current.pointerId)) strip.releasePointerCapture(current.pointerId)
      if (commit && current.started) {
        onMove(current.slots[current.source].id, current.slots[current.target].id)
      }
    }

    const paint = (time: number): void => {
      if (!drag?.started) return
      const { slots, source } = drag
      const bounds = strip.getBoundingClientRect()
      const elapsed = previousTime ? Math.min(time - previousTime, 32) : 16
      previousTime = time
      // Keep scrolling even when the pointer rests at an overflowing strip's edge.
      if (drag.y >= bounds.top - 32 && drag.y <= bounds.bottom + 32) {
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
      sourceSlot.element.classList.add('document-tab-dragging')
      const last = slots[slots.length - 1]
      const left = Math.max(
        slots[0].left,
        Math.min(
          last.left + last.width - sourceSlot.width,
          sourceSlot.left + drag.x - drag.startX + strip.scrollLeft - drag.scrollLeft
        )
      )
      const center = left + sourceSlot.width / 2
      let target = source
      for (let i = 0; i < slots.length; i++) {
        const midpoint = slots[i].left + slots[i].width / 2
        if (i < source && center <= midpoint) {
          target = i
          break
        }
        if (i > source && center >= midpoint) target = i
      }
      drag.target = target
      for (let i = 0; i < slots.length; i++) {
        const offset =
          i === source
            ? left - sourceSlot.left
            : i > source && i <= target
              ? slots[i - 1].left - slots[i].left
              : i < source && i >= target
                ? slots[i + 1].left - slots[i].left
                : 0
        slots[i].element.style.transform = `translateX(${offset}px)`
      }
      frame = requestAnimationFrame(paint)
    }

    const down = (event: PointerEvent): void => {
      suppressClick = false
      if (event.button !== 0 || !event.isPrimary || !(event.target instanceof Element)) return
      if (event.target.closest('button')) return
      const element = event.target.closest<HTMLElement>('.document-tab')
      if (!element || element.parentElement !== strip) return
      const slots = Array.from(strip.querySelectorAll<HTMLElement>(':scope > .document-tab')).map(
        (element) => {
          const bounds = element.getBoundingClientRect()
          return {
            element,
            id: element.dataset.tabId!,
            left: bounds.left,
            width: bounds.width
          }
        }
      )
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
        strip.classList.add('tab-strip-sorting')
        drag.slots[drag.source].element.classList.add('document-tab-dragging')
        onSelect(drag.slots[drag.source].id)
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
  }, [stripRef, order, onSelect, onMove])
}
