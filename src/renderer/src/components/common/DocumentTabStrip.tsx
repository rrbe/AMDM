import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/** Equal-width tabs shrink before scrolling; overflow controls stay outside the viewport. */
export function DocumentTabStrip({
  stripRef,
  count,
  activeId,
  kind,
  children
}: {
  stripRef: RefObject<HTMLDivElement | null>
  count: number
  activeId: string | null
  kind: 'query' | 'result'
  children: ReactNode
}): React.JSX.Element {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({
    overflow: false,
    left: false,
    right: false
  })

  useLayoutEffect(() => {
    const container = containerRef.current!
    const strip = stripRef.current!
    const minimum = kind === 'query' ? 72 : 64
    const maximum = kind === 'query' ? 178 : 190
    const maximumGap = kind === 'query' ? 4 : 0
    const updateEdges = (): void => {
      const next = {
        overflow: container.dataset.overflow === 'true',
        left: strip.scrollLeft > 1,
        right: strip.scrollWidth - strip.clientWidth - strip.scrollLeft > 1
      }
      setEdges((previous) =>
        previous.overflow === next.overflow && previous.left === next.left && previous.right === next.right
          ? previous
          : next
      )
    }
    const layout = (): void => {
      const style = getComputedStyle(strip)
      const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
      const newTabWidth = strip.querySelector<HTMLElement>('.qtab-new')?.offsetWidth ?? 0
      const gapCount = Math.max(0, count - 1) + (kind === 'query' ? 1 : 0)
      const available = container.clientWidth - padding - newTabWidth
      const overflow = count * minimum > available
      container.dataset.overflow = String(overflow)
      const space = available - (overflow ? 60 : 0)
      const ratio = Math.max(
        0,
        Math.min(
          1,
          (space - count * minimum) / (count * (maximum - minimum) + gapCount * maximumGap)
        )
      )
      const width = minimum + (maximum - minimum) * ratio
      strip.style.setProperty('--document-tab-width', `${width}px`)
      strip.style.setProperty('--document-tab-gap', `${maximumGap * ratio}px`)
      strip.dataset.compact = String(width < 96)
      if (activeId) {
        strip
          .querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(activeId)}"]`)
          ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      }
      updateEdges()
    }
    layout()
    const observer = new ResizeObserver(layout)
    observer.observe(container)
    strip.addEventListener('scroll', updateEdges, { passive: true })
    return () => {
      observer.disconnect()
      strip.removeEventListener('scroll', updateEdges)
    }
  }, [activeId, count, kind, stripRef])

  const scroll = (direction: number): void => {
    const strip = stripRef.current!
    strip.scrollBy({
      left: direction * strip.clientWidth * 0.9,
      behavior: 'instant'
    })
  }

  return (
    <div ref={containerRef} className={`document-tab-strip-container ${kind}-tab-strip-container`}>
      <button
        className="document-tab-scroll"
        aria-label={t('shell.scrollTabsLeft')}
        disabled={!edges.left}
        onClick={() => scroll(-1)}
      >
        <ChevronLeft size={14} />
      </button>
      <div ref={stripRef} className={kind === 'query' ? 'tab-strip' : 'result-tabs'}>
        {children}
      </div>
      <button
        className="document-tab-scroll"
        aria-label={t('shell.scrollTabsRight')}
        disabled={!edges.right}
        onClick={() => scroll(1)}
      >
        <ChevronRight size={14} />
      </button>
    </div>
  )
}
