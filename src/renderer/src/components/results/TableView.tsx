import { useMemo, useRef, useState, type MouseEvent } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { formatScalar, isExtended, summarize } from '@renderer/lib/ejson'
import { confirmDeleteDoc, docHasId, type DocActionContext } from '@renderer/lib/docActions'
import { ContextMenu, type ContextMenuItem } from '@renderer/components/ContextMenu'
import {
  copyText,
  plainScalarText,
  toPlainJson,
  toShellText,
  toStrictEjson
} from '@renderer/lib/resultCopy'
import { useCopyHotkey } from '@renderer/lib/useCopyHotkey'
import { DocEditor } from './DocEditor'

/**
 * Virtualized table.
 *
 * VIRTUALIZATION APPROACH (ADR-0004 rule 1):
 *  - ROWS are virtualized with `useVirtualizer`; only visible rows (+ overscan)
 *    exist in the DOM, so a 100k-doc result renders the same handful of rows.
 *  - Columns are derived ONCE (memoized on docs identity) by scanning every
 *    document for top-level field names, preserving first-seen order. We
 *    dot-flatten ONE level for nested plain objects (e.g. `address.city`);
 *    EJSON wrappers ({$oid} etc.) are treated as scalar leaves, not flattened.
 *    Deeper recursive flattening is intentionally out of scope (Phase 2).
 *  - The header is CSS-sticky; the whole table scrolls horizontally as a unit.
 *    Columns default to a fixed width but are resizable — drag the handle on a
 *    header cell's right edge; header and body share the per-column width.
 *
 * NOTE: column derivation scans all docs, but the result set is already bounded
 * at the data layer (ADR-0004 rule 2), so this is cheap.
 */

interface TableViewProps {
  docs: unknown[]
  /** When set, rows whose doc has an _id get Edit/Delete actions. */
  docCtx?: DocActionContext | null
}

const ROW_HEIGHT = 24
const COL_WIDTH = 200
const MIN_COL_WIDTH = 60
const INDEX_COL_WIDTH = 56
const ACTIONS_COL_WIDTH = 72

type Dict = Record<string, unknown>

function isPlainObject(value: unknown): value is Dict {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Compute the value for `column` from a document, one-level dot-flattened. */
function cellValue(doc: unknown, column: string): { present: boolean; value: unknown } {
  if (!isPlainObject(doc)) {
    return column === '(value)' ? { present: true, value: doc } : { present: false, value: undefined }
  }
  const dot = column.indexOf('.')
  if (dot === -1) {
    if (!Object.prototype.hasOwnProperty.call(doc, column)) return { present: false, value: undefined }
    return { present: true, value: doc[column] }
  }
  const parent = column.slice(0, dot)
  const child = column.slice(dot + 1)
  const parentVal = doc[parent]
  if (isPlainObject(parentVal) && !isExtended(parentVal)) {
    if (!Object.prototype.hasOwnProperty.call(parentVal, child)) return { present: false, value: undefined }
    return { present: true, value: parentVal[child] }
  }
  return { present: false, value: undefined }
}

export function TableView({ docs, docCtx }: TableViewProps): JSX.Element {
  const parentRef = useRef<HTMLDivElement>(null)
  const [editIndex, setEditIndex] = useState<number | null>(null)
  const showActions = docCtx != null
  // Per-column widths (column name → px); unset columns use COL_WIDTH.
  const [colWidths, setColWidths] = useState<Record<string, number>>({})
  const widthOf = (col: string): number => colWidths[col] ?? COL_WIDTH

  // Selection: a single cell, OR a set of whole rows (multi-select via the #
  // column). The two are mutually exclusive — selecting one clears the other.
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: string } | null>(null)
  const [selectedRows, setSelectedRows] = useState<Set<number>>(() => new Set())
  const [anchorRow, setAnchorRow] = useState<number | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null)

  // Drag a header cell's right-edge handle to resize that column.
  const startColResize = (col: string, e: MouseEvent): void => {
    e.preventDefault()
    const startX = e.clientX
    const startW = widthOf(col)
    const onMove = (ev: globalThis.MouseEvent): void => {
      const w = Math.max(MIN_COL_WIDTH, startW + ev.clientX - startX)
      setColWidths((prev) => ({ ...prev, [col]: w }))
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const columns = useMemo<string[]>(() => {
    const seen = new Set<string>()
    const cols: string[] = []
    let sawNonObject = false
    for (const doc of docs) {
      if (!isPlainObject(doc)) {
        sawNonObject = true
        continue
      }
      for (const [key, val] of Object.entries(doc)) {
        if (isPlainObject(val) && !isExtended(val)) {
          // One-level flatten of nested plain objects.
          const childKeys = Object.keys(val)
          if (childKeys.length === 0) {
            if (!seen.has(key)) {
              seen.add(key)
              cols.push(key)
            }
          } else {
            for (const ck of childKeys) {
              const col = `${key}.${ck}`
              if (!seen.has(col)) {
                seen.add(col)
                cols.push(col)
              }
            }
          }
        } else if (!seen.has(key)) {
          seen.add(key)
          cols.push(key)
        }
      }
    }
    if (sawNonObject && cols.length === 0) cols.push('(value)')
    return cols
  }, [docs])

  const rowVirtualizer = useVirtualizer({
    count: docs.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12
  })

  // Cmd/Ctrl+C: selected rows → a plain-JSON array; else the selected cell.
  useCopyHotkey(() => {
    if (selectedRows.size > 0) {
      return toPlainJson([...selectedRows].sort((a, b) => a - b).map((i) => docs[i]))
    }
    if (selectedCell) {
      const { present, value } = cellValue(docs[selectedCell.row], selectedCell.col)
      return present ? plainScalarText(value) : ''
    }
    return null
  })

  const selectCell = (row: number, col: string): void => {
    setSelectedRows(new Set())
    setSelectedCell({ row, col })
  }
  const selectRow = (row: number, e: MouseEvent): void => {
    setSelectedCell(null)
    if (e.shiftKey && anchorRow !== null) {
      const [a, b] = anchorRow <= row ? [anchorRow, row] : [row, anchorRow]
      const next = new Set<number>()
      for (let i = a; i <= b; i++) next.add(i)
      setSelectedRows(next)
    } else if (e.metaKey || e.ctrlKey) {
      setSelectedRows((prev) => {
        const next = new Set(prev)
        if (next.has(row)) next.delete(row)
        else next.add(row)
        return next
      })
      setAnchorRow(row)
    } else {
      setSelectedRows(new Set([row]))
      setAnchorRow(row)
    }
  }
  const openMenu = (e: MouseEvent, row: number, col: string | null): void => {
    e.preventDefault()
    // Right-clicking inside a multi-selection keeps it; otherwise focus this row.
    const rows = selectedRows.has(row) ? [...selectedRows].sort((a, b) => a - b) : [row]
    if (!selectedRows.has(row)) {
      if (col) selectCell(row, col)
      else {
        setSelectedRows(new Set([row]))
        setSelectedCell(null)
        setAnchorRow(row)
      }
    }
    setMenu({ x: e.clientX, y: e.clientY, items: tableMenuItems(rows, row, col, docs) })
  }

  if (docs.length === 0) {
    return <div className="center-msg muted">No documents.</div>
  }

  const totalWidth =
    INDEX_COL_WIDTH +
    columns.reduce((sum, c) => sum + widthOf(c), 0) +
    (showActions ? ACTIONS_COL_WIDTH : 0)

  const editDoc = editIndex !== null ? docs[editIndex] : undefined

  return (
    <div ref={parentRef} className="table-scroller">
      <div className="tbl" style={{ width: totalWidth, height: rowVirtualizer.getTotalSize() + ROW_HEIGHT }}>
        {/* Sticky header */}
        <div className="tbl-head" style={{ width: totalWidth }}>
          <div className="tbl-th idx" style={{ width: INDEX_COL_WIDTH }}>
            #
          </div>
          {columns.map((col) => (
            <div key={col} className="tbl-th" style={{ width: widthOf(col) }} title={col}>
              {col}
              <span
                className="tbl-col-resizer"
                onMouseDown={(e) => startColResize(col, e)}
              />
            </div>
          ))}
          {showActions && (
            <div className="tbl-th idx" style={{ width: ACTIONS_COL_WIDTH }}>
              actions
            </div>
          )}
        </div>

        {/* Virtualized rows */}
        {rowVirtualizer.getVirtualItems().map((vi) => {
          const doc = docs[vi.index]
          const rowId = docHasId(doc) ? doc._id : undefined
          return (
            <div
              key={vi.index}
              className={`tbl-row${selectedRows.has(vi.index) ? ' selected' : ''}`}
              style={{ transform: `translateY(${vi.start + ROW_HEIGHT}px)`, width: totalWidth }}
            >
              <div
                className="tbl-td idx idx-select"
                style={{ width: INDEX_COL_WIDTH }}
                onClick={(e) => selectRow(vi.index, e)}
                onContextMenu={(e) => openMenu(e, vi.index, null)}
                title="点击选中整行（Shift / ⌘ 多选）"
              >
                {vi.index + 1}
              </div>
              {columns.map((col) => (
                <Cell
                  key={col}
                  doc={doc}
                  column={col}
                  width={widthOf(col)}
                  selected={selectedCell?.row === vi.index && selectedCell?.col === col}
                  onClick={() => selectCell(vi.index, col)}
                  onContextMenu={(e) => openMenu(e, vi.index, col)}
                />
              ))}
              {showActions && (
                <div className="tbl-td tbl-actions" style={{ width: ACTIONS_COL_WIDTH }}>
                  {docCtx && docHasId(doc) && (
                    <>
                      <button className="ghost row-act" title="Edit document" onClick={() => setEditIndex(vi.index)}>
                        ✎
                      </button>
                      <button
                        className="ghost row-act danger"
                        title="Delete document"
                        onClick={() => void confirmDeleteDoc(docCtx, rowId)}
                      >
                        🗑
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {docCtx && editIndex !== null && docHasId(editDoc) && (
        <DocEditor
          connectionId={docCtx.connectionId}
          database={docCtx.database}
          collection={docCtx.collection}
          doc={editDoc}
          id={editDoc._id}
          onClose={() => setEditIndex(null)}
        />
      )}

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      )}
    </div>
  )
}

/** Right-click copy menu for a table cell / row(s). */
function tableMenuItems(
  rows: number[],
  row: number,
  col: string | null,
  docs: unknown[]
): ContextMenuItem[] {
  const items: ContextMenuItem[] = []
  if (col) {
    const { present, value } = cellValue(docs[row], col)
    items.push({ label: '复制单元格', onClick: () => void copyText(present ? plainScalarText(value) : '') })
  }
  const single = docs[row]
  items.push({ label: '复制行 (文档)', onClick: () => void copyText(toPlainJson(single)) })
  if (rows.length > 1) {
    const sel = rows.map((i) => docs[i])
    items.push({ label: `复制 ${rows.length} 行`, onClick: () => void copyText(toPlainJson(sel)) })
  }
  items.push({ label: '复制行 (Shell 风格)', onClick: () => void copyText(toShellText(single)) })
  items.push({ label: '复制行 (严格 EJSON)', onClick: () => void copyText(toStrictEjson(single)) })
  return items
}

function Cell({
  doc,
  column,
  width,
  selected,
  onClick,
  onContextMenu
}: {
  doc: unknown
  column: string
  width: number
  selected: boolean
  onClick: () => void
  onContextMenu: (e: MouseEvent) => void
}): JSX.Element {
  const { present, value } = cellValue(doc, column)
  const cellCls = `tbl-td${selected ? ' selected' : ''}`
  if (!present) {
    return (
      <div className={cellCls} style={{ width }} onClick={onClick} onContextMenu={onContextMenu}>
        <span className="empty">—</span>
      </div>
    )
  }
  // Containers show a compact summary; scalars/EJSON show formatted text.
  const display =
    isPlainObject(value) && !isExtended(value)
      ? summarize(value)
      : Array.isArray(value)
        ? summarize(value)
        : formatScalar(value)
  const text = typeof display === 'string' ? display : display.text
  const cls = typeof display === 'string' ? 'v-object' : `v-${display.type}`
  return (
    <div className={cellCls} style={{ width }} title={text} onClick={onClick} onContextMenu={onContextMenu}>
      <span className={cls}>{text}</span>
    </div>
  )
}
