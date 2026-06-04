import { useMemo, useRef, useState, type MouseEvent } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { formatScalar, isExtended, summarize } from '@renderer/lib/ejson'
import { cellValue, deriveColumns, isPlainObject } from '@renderer/lib/tableShape'
import { coerceEdit, editableText } from '@renderer/lib/cellEdit'
import { confirmDeleteDoc, docHasId, type DocActionContext } from '@renderer/lib/docActions'
import { computeSelection } from '@renderer/lib/selection'
import { useAppStore } from '@renderer/store/useAppStore'
import { ContextMenu, type ContextMenuItem } from '@renderer/components/ContextMenu'
import {
  copyText,
  plainScalarText,
  toCsv,
  toPlainJson,
  toShellText,
  toStrictEjson,
  toTsv
} from '@renderer/lib/resultCopy'
import { useCopyHotkey } from '@renderer/lib/useCopyHotkey'
import { CellInput } from './CellInput'
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

export function TableView({ docs, docCtx }: TableViewProps): JSX.Element {
  const parentRef = useRef<HTMLDivElement>(null)
  const setDocumentField = useAppStore((s) => s.setDocumentField)
  // Document open in the full-document modal editor (null = none).
  const [editIndex, setEditIndex] = useState<number | null>(null)
  // Inline edit: which cell, and whether the last commit failed validation.
  const [editing, setEditing] = useState<{ row: number; col: string } | null>(null)
  const [editError, setEditError] = useState<string | null>(null)
  // Per-column widths (column name → px); unset columns use COL_WIDTH.
  const [colWidths, setColWidths] = useState<Record<string, number>>({})
  const widthOf = (col: string): number => colWidths[col] ?? COL_WIDTH

  // Selection: a set of whole rows, plus the one "focused" cell that gets an
  // extra overlay highlight on top of its (already selected) row. A single click
  // on any cell selects that whole row and focuses the cell; the # handle selects
  // a row without focusing a cell. Shift extends a row range, ⌘/Ctrl toggles —
  // but no modifier is needed: a plain click already selects the row.
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

  const columns = useMemo<string[]>(() => deriveColumns(docs), [docs])

  const rowVirtualizer = useVirtualizer({
    count: docs.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12
  })

  // Cmd/Ctrl+C: selected rows → a plain-JSON array; else the selected cell.
  useCopyHotkey(() => {
    if (selectedRows.size > 0) {
      const picked = [...selectedRows].sort((a, b) => a - b).map((i) => docs[i])
      return picked.length === 1 ? toPlainJson(picked[0]) : toPlainJson(picked)
    }
    if (selectedCell) {
      const { present, value } = cellValue(docs[selectedCell.row], selectedCell.col)
      return present ? plainScalarText(value) : ''
    }
    return null
  })

  // Core row-selection logic shared by cell clicks and the # handle: plain = just
  // this row, Shift = range from the anchor, ⌘/Ctrl = toggle (see selection.ts).
  const applyRowSelection = (row: number, e: MouseEvent): void => {
    const { selection, anchor } = computeSelection(selectedRows, row, anchorRow, {
      shift: e.shiftKey,
      meta: e.metaKey,
      ctrl: e.ctrlKey
    })
    setSelectedRows(selection)
    setAnchorRow(anchor)
  }
  // Single-click a cell: select its whole row AND focus that cell (cell overlay).
  // Double-click edits (see the Cell handlers) — no modifier key needed here.
  const clickCell = (row: number, col: string, e: MouseEvent): void => {
    setSelectedCell({ row, col })
    applyRowSelection(row, e)
  }
  // The # column selects the row without focusing any cell.
  const clickHandle = (row: number, e: MouseEvent): void => {
    setSelectedCell(null)
    applyRowSelection(row, e)
  }
  // A cell is inline-editable when we know the collection, the row's doc has an
  // _id, the column isn't _id, and the value is a supported scalar.
  const canEditCell = (row: number, col: string): boolean => {
    if (!docCtx || col === '_id') return false
    const doc = docs[row]
    if (!docHasId(doc)) return false
    const { present, value } = cellValue(doc, col)
    return present && editableText(value) != null
  }
  const startEditCell = (row: number, col: string): void => {
    setEditError(null)
    setEditing({ row, col })
  }
  const commitCell = async (row: number, col: string, text: string): Promise<void> => {
    const doc = docs[row]
    if (!docCtx || !docHasId(doc)) return
    const { present, value } = cellValue(doc, col)
    if (!present) return
    const coerced = coerceEdit(value, text)
    if ('error' in coerced) {
      setEditError(coerced.error)
      return
    }
    const res = await setDocumentField({
      connectionId: docCtx.connectionId,
      database: docCtx.database,
      collection: docCtx.collection,
      id: doc._id,
      path: col,
      valueEjson: JSON.stringify(coerced.value)
    })
    if (res.ok) {
      setEditing(null)
      setEditError(null)
    } else {
      setEditError(res.error ?? '保存失败')
    }
  }

  const openMenu = (e: MouseEvent, row: number, col: string | null): void => {
    e.preventDefault()
    // Right-clicking inside a multi-selection keeps it; otherwise focus this row
    // (and the cell under the cursor, if any).
    const rows = selectedRows.has(row) ? [...selectedRows].sort((a, b) => a - b) : [row]
    if (!selectedRows.has(row)) {
      setSelectedRows(new Set([row]))
      setSelectedCell(col ? { row, col } : null)
      setAnchorRow(row)
    }
    const items = tableMenuItems(rows, row, col, docs)
    const doc = docs[row]
    if (docCtx && docHasId(doc)) {
      items.push({ label: '编辑文档…', onClick: () => setEditIndex(row) })
      items.push({
        label: '删除文档',
        danger: true,
        onClick: () => void confirmDeleteDoc(docCtx, doc._id)
      })
    }
    setMenu({ x: e.clientX, y: e.clientY, items })
  }

  if (docs.length === 0) {
    return <div className="center-msg muted">No documents.</div>
  }

  const totalWidth = INDEX_COL_WIDTH + columns.reduce((sum, c) => sum + widthOf(c), 0)

  const editDoc = editIndex !== null ? docs[editIndex] : undefined

  return (
    <div
      ref={parentRef}
      className="table-scroller"
      // Focusable so a grid click moves focus off the query editor — otherwise
      // ⌘C stays "in" the editor and useCopyHotkey defers to native copy instead
      // of copying the selected row(s). Skip when the mousedown lands in the
      // inline cell editor so editing keeps focus.
      tabIndex={-1}
      onMouseDown={(e) => {
        if (!(e.target as HTMLElement).closest('input, textarea, .cm-editor'))
          parentRef.current?.focus({ preventScroll: true })
      }}
    >
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
        </div>

        {/* Virtualized rows */}
        {rowVirtualizer.getVirtualItems().map((vi) => {
          const doc = docs[vi.index]
          return (
            <div
              key={vi.index}
              className={`tbl-row${selectedRows.has(vi.index) ? ' selected' : ''}`}
              style={{ transform: `translateY(${vi.start + ROW_HEIGHT}px)`, width: totalWidth }}
            >
              <div
                className="tbl-td idx idx-select"
                style={{ width: INDEX_COL_WIDTH }}
                onClick={(e) => clickHandle(vi.index, e)}
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
                  editing={editing?.row === vi.index && editing?.col === col}
                  editError={editError}
                  onClick={(e) => clickCell(vi.index, col, e)}
                  onDoubleClick={() => canEditCell(vi.index, col) && startEditCell(vi.index, col)}
                  onCommit={(text) => void commitCell(vi.index, col, text)}
                  onCancel={() => {
                    setEditing(null)
                    setEditError(null)
                  }}
                  onContextMenu={(e) => openMenu(e, vi.index, col)}
                />
              ))}
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
  const sel = rows.map((i) => docs[i]) // effective rows: the multi-selection, or just this row
  const many = rows.length > 1
  items.push({ label: many ? `复制 ${rows.length} 行 (Pure JSON)` : '复制行 (Pure JSON)', onClick: () => void copyText(many ? toPlainJson(sel) : toPlainJson(single)) })
  items.push({ label: '复制行 (MongoShell JS)', onClick: () => void copyText(many ? toShellText(sel) : toShellText(single)) })
  items.push({ label: '复制行 (Extended JSON)', onClick: () => void copyText(many ? toStrictEjson(sel) : toStrictEjson(single)) })
  items.push({ label: '复制为 CSV', onClick: () => void copyText(toCsv(sel)) })
  items.push({ label: '复制为 TSV', onClick: () => void copyText(toTsv(sel)) })
  return items
}

function Cell({
  doc,
  column,
  width,
  selected,
  editing,
  editError,
  onClick,
  onDoubleClick,
  onCommit,
  onCancel,
  onContextMenu
}: {
  doc: unknown
  column: string
  width: number
  selected: boolean
  editing: boolean
  editError: string | null
  onClick: (e: MouseEvent) => void
  onDoubleClick: () => void
  onCommit: (text: string) => void
  onCancel: () => void
  onContextMenu: (e: MouseEvent) => void
}): JSX.Element {
  const { present, value } = cellValue(doc, column)
  const cellCls = `tbl-td${selected ? ' selected' : ''}`

  if (editing) {
    return (
      <div className={cellCls} style={{ width }}>
        <CellInput
          initial={editableText(value) ?? ''}
          error={editError}
          onCommit={onCommit}
          onCancel={onCancel}
        />
      </div>
    )
  }

  if (!present) {
    return (
      <div
        className={cellCls}
        style={{ width }}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
      >
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
    <div
      className={cellCls}
      style={{ width }}
      title={text}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
    >
      <span className={cls}>{text}</span>
    </div>
  )
}
