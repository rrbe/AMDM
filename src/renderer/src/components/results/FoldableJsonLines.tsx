import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { Tooltip } from '@renderer/components/ui/Tooltip'
import { ChevronRight, ChevronsDownUp, ChevronsUpDown } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useTranslation } from 'react-i18next'
import { indentFor, visibleJsonLineIndexes, type JsonLine, type JsonToken } from '@renderer/lib/format'
import { claimCopyFocus } from '@renderer/lib/useCopyHotkey'

interface FoldableLine {
  depth: number
  text: string
  tokens?: JsonToken[]
  fold?: JsonLine['fold']
}

interface Props<T extends FoldableLine> {
  lines: T[]
  fontSize: number
  controlsContainer: HTMLElement | null
  rowClassName?: (line: T) => string
  allSelected?: boolean
  includeRootInCollapseAll?: boolean
  onMouseDown?: () => void
  onContextMenu?: (event: MouseEvent<HTMLDivElement>) => void
}

const EMPTY_COLLAPSED = new Set<number>()

/** Shared fold controls and line virtualization for JSON results, explain, and printjson. */
export function FoldableJsonLines<T extends FoldableLine>({
  lines,
  fontSize,
  controlsContainer,
  rowClassName,
  allSelected = false,
  includeRootInCollapseAll = false,
  onMouseDown,
  onContextMenu
}: Props<T>): React.JSX.Element {
  const { t } = useTranslation()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [foldState, setFoldState] = useState<{ lines: T[]; collapsed: Set<number> }>(() => ({
    lines,
    collapsed: new Set()
  }))
  const collapsed = foldState.lines === lines ? foldState.collapsed : EMPTY_COLLAPSED
  const foldable = useMemo(() => {
    const indexes: number[] = []
    lines.forEach((line, index) => {
      if (line.fold && (includeRootInCollapseAll || line.depth > 0)) indexes.push(index)
    })
    return indexes
  }, [lines, includeRootInCollapseAll])
  const hasCollapsed = collapsed.size > 0
  const visible = useMemo(() => visibleJsonLineIndexes(lines, collapsed), [lines, collapsed])
  const rowHeight = Math.max(22, fontSize + 8)
  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 20
  })

  useEffect(() => virtualizer.measure(), [fontSize, virtualizer])

  const setCollapsed = (update: (current: Set<number>) => Set<number>): void => {
    setFoldState((previous) => ({
      lines,
      collapsed: update(previous.lines === lines ? previous.collapsed : new Set())
    }))
    window.getSelection()?.removeAllRanges()
  }

  return (
    <div className="foldable-json-lines" style={{ fontSize }}>
      {foldable.length > 0 && controlsContainer && createPortal(
        <Tooltip content={t(hasCollapsed ? 'json.expandAll' : 'json.collapseAll')}>
          <button
            type="button"
            className="json-fold-action"
            aria-label={t(hasCollapsed ? 'json.expandAll' : 'json.collapseAll')}
            aria-expanded={!hasCollapsed}
            onClick={(event) => {
              event.preventDefault()
              setCollapsed(() => hasCollapsed ? new Set() : new Set(foldable))
            }}
          >
            {hasCollapsed
              ? <ChevronsUpDown size={14} aria-hidden="true" />
              : <ChevronsDownUp size={14} aria-hidden="true" />}
          </button>
        </Tooltip>,
        controlsContainer
      )}
      <div
        ref={scrollRef}
        className={`virtual-scroller json-body${allSelected ? ' all-selected' : ''}`}
        tabIndex={-1}
        onMouseDown={(event) => {
          if (event.target instanceof Element && event.target.closest('button')) return
          onMouseDown?.()
          claimCopyFocus(scrollRef.current)
        }}
        onContextMenu={onContextMenu}
      >
        <div className="virtual-inner" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const index = visible[item.index]
            const line = lines[index]
            const fold = line.fold
            const isCollapsed = fold != null && collapsed.has(index)
            const toggle = (): void => setCollapsed((current) => {
              const next = new Set(current)
              if (next.has(index)) next.delete(index)
              else next.add(index)
              return next
            })
            return (
              <div
                key={index}
                className={`vrow json-line${rowClassName ? ` ${rowClassName(line)}` : ''}`}
                style={{ transform: `translateY(${item.start}px)`, height: rowHeight }}
              >
                {line.fold && (
                  <button
                    type="button"
                    className="json-fold-toggle"
                    aria-label={t(isCollapsed ? 'json.expandNode' : 'json.collapseNode')}
                    aria-expanded={!isCollapsed}
                    onClick={toggle}
                  >
                    <ChevronRight size={12} aria-hidden="true" />
                  </button>
                )}
                <pre>
                  {indentFor(line.depth)}
                  {line.tokens ? line.tokens.map((token, tokenIndex) => (
                    <span key={tokenIndex} className={token.cls}>{token.text}</span>
                  )) : line.text}
                  {isCollapsed && fold && (
                    <>
                      <button
                        type="button"
                        className="json-fold-summary"
                        aria-label={t('json.expandNode')}
                        onClick={(event) => {
                          event.currentTarget.closest('.json-line')?.querySelector<HTMLButtonElement>('.json-fold-toggle')?.focus()
                          toggle()
                        }}
                      >…</button>
                      <span className="json-punct">{fold.closeText}</span>
                    </>
                  )}
                </pre>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
