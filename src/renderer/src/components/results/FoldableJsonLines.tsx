import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
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
  const visible = useMemo(() => visibleJsonLineIndexes(lines, collapsed), [lines, collapsed])
  const rowHeight = fontSize + 6
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
      {foldable.length > 0 && (
        <div className="json-fold-toolbar">
          <button
            type="button"
            disabled={foldable.every((index) => collapsed.has(index))}
            onClick={() => setCollapsed((current) => new Set([
              ...foldable,
              ...[...current].filter((index) => lines[index]?.depth === 0)
            ]))}
          >
            {t('json.collapseAll')}
          </button>
          <button
            type="button"
            disabled={collapsed.size === 0}
            onClick={() => setCollapsed(() => new Set())}
          >
            {t('json.expandAll')}
          </button>
        </div>
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
            const tokens = isCollapsed && fold
              ? [...(line.tokens ?? []), { text: ' … ', cls: 'json-punct' }, { text: fold.closeText, cls: 'json-punct' }]
              : line.tokens
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
                    style={{ left: `${line.depth * 2}ch` }}
                    aria-label={t(isCollapsed ? 'json.expandNode' : 'json.collapseNode')}
                    aria-expanded={!isCollapsed}
                    onClick={() => setCollapsed((current) => {
                      const next = new Set(current)
                      if (next.has(index)) next.delete(index)
                      else next.add(index)
                      return next
                    })}
                  >
                    {isCollapsed ? '▸' : '▾'}
                  </button>
                )}
                <pre>
                  {indentFor(line.depth)}
                  {tokens ? tokens.map((token, tokenIndex) => (
                    <span key={tokenIndex} className={token.cls}>{token.text}</span>
                  )) : line.text}
                </pre>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
