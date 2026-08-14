import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import type { CollectionSort, TabularExportFormat } from '@shared/types'
import { formatScalar, isExtended, summarize } from '@renderer/lib/ejson'
import { cellValue, deriveColumns, isPlainObject, sortTableRows, type TableSortState } from '@renderer/lib/tableShape'
import { coerceEdit, editableText } from '@renderer/lib/cellEdit'
import { confirmDeleteDoc, docHasId, type DocActionContext } from '@renderer/lib/docActions'
import { computeVisibleSelection } from '@renderer/lib/selection'
import { useAppStore } from '@renderer/store/useAppStore'
import { ContextMenu, type ContextMenuEntry } from '@renderer/components/ContextMenu'
import {
  copyText,
  compactJsonPreview,
  plainScalarText,
  toCsv,
  toPlainJson,
  toPlainKeyValue,
  toShellText,
  toStrictEjson,
  toTsv
} from '@renderer/lib/resultCopy'
import { claimCopyFocus, useCopyHotkey } from '@renderer/lib/useCopyHotkey'
import i18n from '@renderer/i18n'
import { CellInput } from './CellInput'
import { DocEditor } from './DocEditor'
import { JsonView } from './JsonView'
import { ResizableModal } from '@renderer/components/common/Modal'

/**
 * Virtualized table.
 *
 * VIRTUALIZATION APPROACH:
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
 * at the data layer, so this is cheap.
 */

interface TableViewProps {
  docs: unknown[]
  fontSize: number
  selectedDocIndexes: Set<number>
  onSelectedDocIndexesChange: (selection: Set<number>) => void
  onDocumentOrderChange: (sourceIndexes: number[]) => void
  onExport: (format: TabularExportFormat, documents: unknown[]) => void
  /** When set, rows whose doc has an _id get Edit/Delete actions. */
  docCtx?: DocActionContext | null
}

const COL_WIDTH = 200
const MIN_COL_WIDTH = 60
const INDEX_COL_WIDTH = 56

export function TableView({
  docs,
  fontSize,
  selectedDocIndexes,
  onSelectedDocIndexesChange,
  onDocumentOrderChange,
  onExport,
  docCtx
}: TableViewProps): React.JSX.Element {
  const { t, i18n: tableI18n } = useTranslation()
  const parentRef = useRef<HTMLDivElement>(null)
  const setDocumentField = useAppStore((s) => s.setDocumentField)
  const fieldSort = useAppStore((s) => s.settings.collectionSort)
  // Document open in the full-document modal editor (null = none).
  const [editIndex, setEditIndex] = useState<number | null>(null)
  const [preview, setPreview] = useState<{ column: string; value: unknown } | null>(null)
  // Inline edit: which cell, and whether the last commit failed validation.
  const [editing, setEditing] = useState<{ row: number; col: string } | null>(null)
  const [editError, setEditError] = useState<string | null>(null)
  // Per-column widths (column name → px); unset columns use COL_WIDTH.
  const [colWidths, setColWidths] = useState<Record<string, number>>({})
  const [tableSort, setTableSort] = useState<TableSortState | null>(null)
  const widthOf = (col: string): number => colWidths[col] ?? COL_WIDTH

  // Selection: a set of whole rows, plus the one "focused" cell that gets an
  // extra overlay highlight on top of its (already selected) row. A single click
  // on any cell selects that whole row and focuses the cell; the # handle selects
  // a row without focusing a cell. Shift extends a row range, ⌘/Ctrl toggles —
  // but no modifier is needed: a plain click already selects the row.
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: string } | null>(null)
  const selectedRows = selectedDocIndexes
  const [anchorRow, setAnchorRow] = useState<number | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuEntry[] } | null>(null)

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

  const columns = useMemo<string[]>(() => deriveColumns(docs, fieldSort), [docs, fieldSort])
  const rows = useMemo(
    () => sortTableRows(docs, tableSort, tableI18n.resolvedLanguage ?? tableI18n.language),
    [docs, tableSort, tableI18n.resolvedLanguage, tableI18n.language]
  )

  useEffect(() => {
    onDocumentOrderChange(rows.map((row) => row.sourceIndex))
  }, [onDocumentOrderChange, rows])

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => fontSize + 11,
    overscan: 12
  })

  useEffect(() => rowVirtualizer.measure(), [fontSize, rowVirtualizer])

  // Cmd/Ctrl+C: selected rows → a plain-JSON array; else the selected cell.
  useCopyHotkey(() => {
    if (preview) return null
    if (selectedRows.size > 0) {
      const picked = rows.filter((row) => selectedRows.has(row.sourceIndex)).map((row) => row.doc)
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
  const applyRowSelection = (visibleRow: number, e: MouseEvent): void => {
    const { selection, anchor } = computeVisibleSelection(
      selectedRows,
      visibleRow,
      anchorRow,
      rows.map((row) => row.sourceIndex),
      {
        shift: e.shiftKey,
        meta: e.metaKey,
        ctrl: e.ctrlKey
      }
    )
    onSelectedDocIndexesChange(selection)
    setAnchorRow(anchor)
  }
  // Single-click a cell: select its whole row AND focus that cell (cell overlay).
  const clickCell = (visibleRow: number, sourceRow: number, col: string, e: MouseEvent): void => {
    setSelectedCell({ row: sourceRow, col })
    applyRowSelection(visibleRow, e)
  }
  // The # column selects the row without focusing any cell.
  const clickHandle = (visibleRow: number, e: MouseEvent): void => {
    setSelectedCell(null)
    applyRowSelection(visibleRow, e)
  }
  // A cell is inline-editable when we know the collection, the row's doc has an
  // _id, the column isn't _id, and the value is a supported scalar.
  const canEditCell = (row: number, col: string): boolean => {
    if (!docCtx || col === '_id') return false
    const doc = docs[row]
    if (!docHasId(doc)) return false
    // A literal dotted key is readable/copyable, but Mongo's ordinary update
    // path syntax would target a nested field instead.
    if (col.includes('.') && Object.prototype.hasOwnProperty.call(doc, col)) return false
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
      setEditError(res.error ?? t('table.saveFailed'))
    }
  }

  const openMenu = (e: MouseEvent, row: number, col: string | null): void => {
    e.preventDefault()
    // Right-clicking inside a multi-selection keeps it; otherwise focus this row
    // (and the cell under the cursor, if any).
    const selectedInDisplayOrder = rows
      .filter((candidate) => selectedRows.has(candidate.sourceIndex))
      .map((candidate) => candidate.sourceIndex)
    const selectedIndexes = selectedRows.has(row) ? selectedInDisplayOrder : [row]
    if (!selectedRows.has(row)) {
      onSelectedDocIndexesChange(new Set([row]))
      setAnchorRow(row)
    }
    setSelectedCell(col ? { row, col } : null)
    const doc = docs[row]
    const items: ContextMenuEntry[] = []
    if (docCtx && docHasId(doc)) {
      items.push({
        label: t('result.dataMenu.edit'),
        children: [
          { label: t('table.editDoc'), onClick: () => setEditIndex(row) },
          {
            label: t('table.editCell'),
            disabled: col == null || !canEditCell(row, col),
            onClick: () => {
              if (col != null) startEditCell(row, col)
            }
          }
        ]
      })
    }
    items.push({
      label: t('result.dataMenu.copy'),
      children: tableCopyMenuItems(selectedIndexes, row, col, docs, fieldSort)
    })
    items.push({
      label: t('result.dataMenu.export'),
      children: exportMenuItems(
        selectedIndexes.map((index) => docs[index]),
        onExport
      )
    })
    if (docCtx && docHasId(doc)) {
      items.push('separator')
      items.push({
        label: t('table.deleteDoc'),
        danger: true,
        onClick: () => void confirmDeleteDoc(docCtx, doc._id)
      })
    }
    setMenu({ x: e.clientX, y: e.clientY, items })
  }

  if (docs.length === 0) {
    return <div className="center-msg muted">{t('table.noDocuments')}</div>
  }

  const totalWidth = INDEX_COL_WIDTH + columns.reduce((sum, c) => sum + widthOf(c), 0)

  const editDoc = editIndex !== null ? docs[editIndex] : undefined

  return (
    <div
      ref={parentRef}
      className="table-scroller"
      // Focusable so a grid click claims the ⌘C hotkey: claimCopyFocus moves
      // focus off the query editor AND clears a selection lingering there
      // (user-select:none rows don't collapse it natively — useCopyHotkey would
      // defer to native copy, which copies nothing). Skip when the mousedown
      // lands in the inline cell editor so editing keeps focus.
      tabIndex={-1}
      onMouseDown={(e) => {
        if (!e.currentTarget.contains(e.target as Node)) return
        if (!(e.target as HTMLElement).closest('input, textarea, .cm-editor'))
          claimCopyFocus(parentRef.current)
      }}
    >
      <div className="tbl" style={{ width: totalWidth, height: rowVirtualizer.getTotalSize() + fontSize + 11 }}>
        {/* Sticky header */}
        <div className="tbl-head" style={{ width: totalWidth }}>
          <div className="tbl-th idx" style={{ width: INDEX_COL_WIDTH }}>
            #
          </div>
          {columns.map((col) => (
            <div
              key={col}
              className="tbl-th"
              style={{ width: widthOf(col) }}
              role="columnheader"
              aria-sort={
                tableSort?.column === col ? (tableSort.direction === 'asc' ? 'ascending' : 'descending') : 'none'
              }
            >
              <button
                type="button"
                className={`tbl-sort-trigger${tableSort?.column === col ? ' active' : ''}`}
                data-tip={
                  tableSort?.column !== col
                    ? t('table.sortAscending', { column: col })
                    : tableSort.direction === 'asc'
                      ? t('table.sortDescending', { column: col })
                      : t('table.clearSort', { column: col })
                }
                aria-label={
                  tableSort?.column !== col
                    ? t('table.sortAscending', { column: col })
                    : tableSort.direction === 'asc'
                      ? t('table.sortDescending', { column: col })
                      : t('table.clearSort', { column: col })
                }
                onClick={() =>
                  setTableSort((current) => {
                    if (current?.column !== col) return { column: col, direction: 'asc' }
                    if (current.direction === 'asc') return { column: col, direction: 'desc' }
                    return null
                  })
                }
              >
                <span className="tbl-col-label">{col}</span>
                {tableSort?.column === col ? (
                  tableSort.direction === 'asc' ? (
                    <ArrowUp size={13} aria-hidden="true" />
                  ) : (
                    <ArrowDown size={13} aria-hidden="true" />
                  )
                ) : (
                  <ChevronsUpDown size={13} className="tbl-sort-idle" aria-hidden="true" />
                )}
              </button>
              <span className="tbl-col-resizer" onMouseDown={(e) => startColResize(col, e)} />
            </div>
          ))}
        </div>

        {/* Virtualized rows */}
        {rowVirtualizer.getVirtualItems().map((vi) => {
          const { doc, sourceIndex } = rows[vi.index]
          return (
            <div
              key={sourceIndex}
              className={`tbl-row${selectedRows.has(sourceIndex) ? ' selected' : ''}`}
              style={{ transform: `translateY(${vi.start + fontSize + 11}px)`, width: totalWidth }}
            >
              <div
                className="tbl-td idx idx-select"
                style={{ width: INDEX_COL_WIDTH }}
                onClick={(e) => clickHandle(vi.index, e)}
                onContextMenu={(e) => openMenu(e, sourceIndex, null)}
                data-tip={t('table.selectRowTip')}
              >
                {vi.index + 1}
              </div>
              {columns.map((col) => (
                <Cell
                  key={col}
                  doc={doc}
                  column={col}
                  width={widthOf(col)}
                  selected={selectedCell?.row === sourceIndex && selectedCell?.col === col}
                  editing={editing?.row === sourceIndex && editing?.col === col}
                  editError={editError}
                  onClick={(e) => clickCell(vi.index, sourceIndex, col, e)}
                  onOpen={(value) => setPreview({ column: col, value })}
                  onCommit={(text) => void commitCell(sourceIndex, col, text)}
                  onCancel={() => {
                    setEditing(null)
                    setEditError(null)
                  }}
                  onContextMenu={(e) => openMenu(e, sourceIndex, col)}
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

      {preview && (
        <ResizableModal
          title={preview.column}
          backdropClassName="fixed inset-0 z-[1000] bg-[var(--backdrop-dialog)]"
          onClose={() => setPreview(null)}
        >
          <div className="h-full min-h-0 overflow-hidden rounded-md border border-[var(--separator)] p-3">
            <JsonView value={preview.value} fontSize={fontSize} />
          </div>
        </ResizableModal>
      )}

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      )}
    </div>
  )
}

function exportMenuItems(
  documents: unknown[],
  onExport: (format: TabularExportFormat, documents: unknown[]) => void
): ContextMenuEntry[] {
  return [
    {
      label: i18n.t('result.export.csv'),
      onClick: () => onExport('csv', documents)
    },
    {
      label: i18n.t('result.export.tsv'),
      onClick: () => onExport('tsv', documents)
    },
    {
      label: i18n.t('result.export.xlsx'),
      onClick: () => onExport('xlsx', documents)
    }
  ]
}

/** Right-click copy menu for a table cell / row(s). */
function tableCopyMenuItems(
  rows: number[],
  row: number,
  col: string | null,
  docs: unknown[],
  fieldSort: CollectionSort
): ContextMenuEntry[] {
  const cell = col == null ? { present: false, value: undefined } : cellValue(docs[row], col)
  const hasValue = col != null && cell.present
  const single = docs[row]
  const sel = rows.map((i) => docs[i]) // effective rows: the multi-selection, or just this row
  const many = rows.length > 1
  const formatted = many ? sel : single
  return [
    {
      label: i18n.t('result.dataMenu.copyKey'),
      disabled: col == null,
      onClick: () => void copyText(col ?? '')
    },
    {
      label: i18n.t('result.dataMenu.copyValue'),
      disabled: !hasValue,
      onClick: () => void copyText(plainScalarText(cell.value))
    },
    {
      label: i18n.t('result.dataMenu.copyKeyValue'),
      disabled: !hasValue,
      onClick: () => void copyText(toPlainKeyValue(col ?? '', cell.value))
    },
    'separator',
    {
      label: i18n.t('result.dataMenu.copyPureJson'),
      onClick: () => void copyText(toPlainJson(formatted))
    },
    {
      label: i18n.t('result.dataMenu.copyMongoShell'),
      onClick: () => void copyText(toShellText(formatted))
    },
    {
      label: i18n.t('result.dataMenu.copyExtendedJson'),
      onClick: () => void copyText(toStrictEjson(formatted))
    },
    'separator',
    {
      label: i18n.t('result.dataMenu.copyCsv'),
      onClick: () => void copyText(toCsv(sel, fieldSort))
    },
    {
      label: i18n.t('result.dataMenu.copyTsv'),
      onClick: () => void copyText(toTsv(sel, fieldSort))
    }
  ]
}

function Cell({
  doc,
  column,
  width,
  selected,
  editing,
  editError,
  onClick,
  onOpen,
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
  onOpen: (value: unknown) => void
  onCommit: (text: string) => void
  onCancel: () => void
  onContextMenu: (e: MouseEvent) => void
}): React.JSX.Element {
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
  const expandable = Array.isArray(value) || (isPlainObject(value) && !isExtended(value))
  return (
    <div
      className={cellCls}
      style={{ width, cursor: expandable ? 'pointer' : undefined }}
      data-tip={expandable ? compactJsonPreview(value) : text}
      role={expandable ? 'button' : undefined}
      tabIndex={expandable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (expandable && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onOpen(value)
        }
      }}
      onDoubleClick={expandable ? () => onOpen(value) : undefined}
      onContextMenu={onContextMenu}
    >
      <span className={cls}>{text}</span>
    </div>
  )
}
