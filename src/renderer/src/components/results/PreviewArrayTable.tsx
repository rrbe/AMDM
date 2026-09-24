import { useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useTranslation } from 'react-i18next'
import { formatScalar, isExtended } from '@renderer/lib/ejson'
import { toInlineJsonTokens } from '@renderer/lib/format'
import { cellValue, deriveColumns, isPlainObject } from '@renderer/lib/tableShape'
import { formatJsonPreview } from '@renderer/lib/resultCopy'
import { useAppStore } from '@renderer/store/useAppStore'
import { Tooltip } from '@renderer/components/ui/Tooltip'

const INDEX_WIDTH = 56
const COLUMN_WIDTH = 200

/** Read-only, virtualized table for an array already loaded in a value preview. */
export function PreviewArrayTable({ value, fontSize }: { value: unknown[]; fontSize: number }): React.JSX.Element {
  const { t } = useTranslation()
  const sort = useAppStore((state) => state.settings.collectionSort)
  const columns = useMemo(() => deriveColumns(value, sort), [value, sort])
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
            <div key={item.key} className="tbl-th" style={{ position: 'absolute', left: item.start, width: item.size, paddingLeft: 10 }} title={columns[item.index]}>
              {columns[item.index]}
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
              const cell = cellValue(value[row.index], column)
              const nested = cell.present && (Array.isArray(cell.value) || (isPlainObject(cell.value) && !isExtended(cell.value)))
              const tokens = nested ? toInlineJsonTokens(cell.value) : null
              const scalar = cell.present && !nested ? formatScalar(cell.value) : null
              const content = (
                <div
                  key={column}
                  className="tbl-td"
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
                  key={column}
                  content={() => formatJsonPreview(cell.value).text}
                  variant="code"
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
