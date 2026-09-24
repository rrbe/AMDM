import { useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useTranslation } from 'react-i18next'
import { formatScalar, isExtended } from '@renderer/lib/ejson'
import { toInlineJsonTokens } from '@renderer/lib/format'
import { isPlainObject } from '@renderer/lib/tableShape'
import { previewArrayCell, previewArrayColumns } from '@renderer/lib/previewArray'
import { formatJsonPreview } from '@renderer/lib/resultCopy'
import { useAppStore } from '@renderer/store/useAppStore'
import { Tooltip } from '@renderer/components/ui/Tooltip'

const INDEX_WIDTH = 56
const COLUMN_WIDTH = 200

/** Read-only, virtualized table for an array already loaded in a value preview. */
interface PreviewArrayTableProps {
  value: unknown[]
  fontSize: number
  onOpen: (value: unknown, label: string, trigger: HTMLElement) => void
}

export function PreviewArrayTable({ value, fontSize, onOpen }: PreviewArrayTableProps): React.JSX.Element {
  const { t } = useTranslation()
  const openLabel = t('result.previewOpen')
  const openHint = t('result.previewOpenHint')
  const sort = useAppStore((state) => state.settings.collectionSort)
  const columns = useMemo(() => previewArrayColumns(value, sort), [value, sort])
  const scrollRef = useRef<HTMLDivElement>(null)
  const rowHeight = fontSize + 11
  const virtualizer = useVirtualizer({
    count: value.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 12
  })
  const columnVirtualizer = useVirtualizer({
    horizontal: true,
    count: columns.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => COLUMN_WIDTH,
    paddingStart: INDEX_WIDTH,
    overscan: 2
  })
  const visibleColumns = columnVirtualizer.getVirtualItems()
  const width = INDEX_WIDTH + columns.length * COLUMN_WIDTH

  if (value.length === 0) return <div className="center-msg muted">{t('table.noDocuments')}</div>

  return (
    <div ref={scrollRef} className="table-scroller has-pinned-id" style={{ fontSize, ['--data-font-size' as string]: `${fontSize}px` }}>
      <div className="tbl" style={{ width, height: virtualizer.getTotalSize() + rowHeight }}>
        <div className="tbl-head" style={{ width, height: rowHeight }}>
          <div className="tbl-th idx" style={{ width: INDEX_WIDTH }}>#</div>
          {visibleColumns.map((item) => (
            <div key={item.key} className="tbl-th" style={{ position: 'absolute', left: item.start, width: item.size, paddingLeft: 10 }} title={columns[item.index].label}>
              {columns[item.index].label}
            </div>
          ))}
        </div>
        {virtualizer.getVirtualItems().map((row) => (
          <div
            key={row.key}
            className="tbl-row"
            style={{ width, transform: `translateY(${row.start + rowHeight}px)` }}
          >
            <div className="tbl-td idx" style={{ width: INDEX_WIDTH }}>{row.index + 1}</div>
            {visibleColumns.map((item) => {
              const column = columns[item.index]
              const cell = previewArrayCell(value[row.index], column)
              const nested = cell.present && (Array.isArray(cell.value) || (isPlainObject(cell.value) && !isExtended(cell.value)))
              const tokens = nested ? toInlineJsonTokens(cell.value) : null
              const scalar = cell.present && !nested ? formatScalar(cell.value) : null
              const path = `[${row.index}]${column.field === null ? '' : `[${JSON.stringify(column.field)}]`}`
              const content = (
                <div
                  key={item.key}
                  className={`tbl-td${nested ? ' cursor-pointer hover:bg-[var(--interaction-hover)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--separator-strong)] focus-visible:-outline-offset-1' : ''}`}
                  role={nested ? 'button' : undefined}
                  tabIndex={nested ? 0 : undefined}
                  aria-label={nested ? `${openLabel}: ${path}` : undefined}
                  onClick={nested ? (event) => onOpen(cell.value, path, event.currentTarget) : undefined}
                  onKeyDown={nested ? (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      event.currentTarget.click()
                    }
                  } : undefined}
                  style={{ position: 'absolute', left: item.start, width: item.size }}
                  title={scalar?.text}
                >
                  {!cell.present ? (
                    <span className="empty">—</span>
                  ) : tokens ? (
                    tokens.map((token, index) => <span key={index} className={token.cls}>{token.text}</span>)
                  ) : (
                    <span className={`v-${scalar!.type}`}>{scalar!.text}</span>
                  )}
                </div>
              )
              return nested ? (
                <Tooltip
                  key={item.key}
                  content={() => formatJsonPreview(cell.value).text}
                  variant="code"
                  footer={openHint}
                >
                  {content}
                </Tooltip>
              ) : content
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
