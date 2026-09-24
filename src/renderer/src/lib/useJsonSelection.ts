import { useEffect, type RefObject } from 'react'

/** Paint native text selections at row height without changing selection or copy semantics. */
export function useJsonSelection(scrollRef: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    let frame = 0
    let painted: HTMLElement[] = []
    const paint = (): void => {
      frame = 0
      const selection = window.getSelection()
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null
      const active = range && !range.collapsed && scroller.contains(range.startContainer) && scroller.contains(range.endContainer)
      const rectangles: { row: HTMLElement; left: number; right: number }[] = []
      if (active) {
        // Only mounted rows are measured; no work scales with the full result size.
        for (const pre of scroller.querySelectorAll('pre')) {
          if (!range.intersectsNode(pre)) continue
          const part = document.createRange()
          part.selectNodeContents(pre)
          const startsHere = pre.contains(range.startContainer)
          const endsHere = pre.contains(range.endContainer)
          if (startsHere) part.setStart(range.startContainer, range.startOffset)
          if (endsHere) part.setEnd(range.endContainer, range.endOffset)
          if (part.collapsed) continue
          const row = pre.parentElement!
          const bounds = row.getBoundingClientRect()
          const text = part.getBoundingClientRect()
          rectangles.push({
            row,
            left: startsHere ? text.left - bounds.left : pre.offsetLeft + parseFloat(getComputedStyle(pre).paddingLeft),
            right: endsHere ? text.right - bounds.left : row.clientWidth
          })
        }
      }
      // Batch writes after all geometry reads to avoid per-row layout flushes.
      for (const row of painted) row.classList.remove('json-text-selected')
      scroller.classList.toggle('json-custom-selection', Boolean(active))
      painted = rectangles.map(({ row, left, right }) => {
        row.style.setProperty('--json-selection-left', `${left}px`)
        row.style.setProperty('--json-selection-width', `${Math.max(0, right - left)}px`)
        row.classList.add('json-text-selected')
        return row
      })
    }
    const schedule = (): void => {
      if (!frame) frame = requestAnimationFrame(paint)
    }
    document.addEventListener('selectionchange', schedule)
    scroller.addEventListener('scroll', schedule, { passive: true })
    const resize = new ResizeObserver(schedule)
    resize.observe(scroller)
    if (scroller.firstElementChild) resize.observe(scroller.firstElementChild)
    // Virtualization, folding, and font changes may move or replace selected rows.
    const mutations = new MutationObserver(schedule)
    mutations.observe(scroller, { childList: true, subtree: true, characterData: true })
    schedule()
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('selectionchange', schedule)
      scroller.removeEventListener('scroll', schedule)
      resize.disconnect()
      mutations.disconnect()
      for (const row of painted) row.classList.remove('json-text-selected')
      scroller.classList.remove('json-custom-selection')
    }
  }, [scrollRef])
}
