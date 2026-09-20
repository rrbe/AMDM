import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import type { CollectionSort, JsonEncoding, ResultExportFormat } from '@shared/types'
import { formatScalar, isExtended } from '@renderer/lib/ejson'
import { toInlineJsonTokens } from '@renderer/lib/format'
import {
  cellValue,
  deriveTableColumnGroups,
  isPlainObject,
  orderTableColumns,
  sortTableRows,
  type TableColumn,
  type TableSortDirection,
  type TableSortState
} from '@renderer/lib/tableShape'
import { useHorizontalReorder } from '@renderer/lib/useHorizontalReorder'
import { coerceEdit, editableText } from '@renderer/lib/cellEdit'
import { confirmDeleteDoc, docHasId, type DocActionContext } from '@renderer/lib/docActions'
import { computeVisibleSelection } from '@renderer/lib/selection'
import { getActiveTab, useAppStore } from '@renderer/store/useAppStore'
import { ContextMenu, type ContextMenuEntry } from '@renderer/components/ContextMenu'
import {
  copyText,
  formatJsonPreview,
  plainScalarText,
  tableCellCopyText,
  toCsv,
  toPlainJson,
  toPlainKeyValue,
  toShellText,
  toTsv
} from '@renderer/lib/resultCopy'
import { claimCopyFocus, useCopyHotkey } from '@renderer/lib/useCopyHotkey'
import i18n from '@renderer/i18n'
import { CellInput } from './CellInput'
import { DocEditor } from './DocEditor'
import { JsonPreviewModal, type JsonPreviewSource } from './JsonPreviewModal'
import { Tooltip } from '@renderer/components/ui/Tooltip'
import { jsonCopyMenuItems, resultExportMenuItems } from './documentFormatMenus'

/**
 * Virtualized table.
 *
 * VIRTUALIZATION APPROACH:
 *  - ROWS are virtualized with `useVirtualizer`; only visible rows (+ overscan)
 *    exist in the DOM, so a 100k-doc result renders the same handful of rows.
 *  - Columns are derived ONCE (memoized on docs identity) by scanning every
 *    document for top-level field names, preserving first-seen order. We
 *    show nested values inline by default; grouped mode gives object fields
 *    a second header row and independent child columns.
 *    EJSON wrappers ({$oid} etc.) are treated as scalar leaves.
 *  - The header sticks vertically; row handles and _id stay visible horizontally.
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
  onExport: (format: ResultExportFormat, documents: unknown[], jsonEncoding?: JsonEncoding) => void
  /** When set, rows whose doc has an _id get Edit/Delete actions. */
  docCtx?: DocActionContext | null
}

const COL_WIDTH = 200
const MIN_COL_WIDTH = 60
const INDEX_COL_WIDTH = 56
const COLUMN_REORDER = {
  itemSelector: '.tbl-column-group[data-column]:not(.tbl-pinned-id)',
  idAttribute: 'data-column',
  ignoreSelector: '.tbl-col-resizer, .tbl-group-children',
  sortingClass: 'table-columns-sorting',
  draggingClass: 'tbl-column-dragging'
}

function columnStyle(width: number, index: number): CSSProperties {
  return {
    width,
    transform: `var(--reorder-offset-${index})`,
    zIndex: `var(--reorder-z-${index})`,
    transitionDuration: `var(--reorder-duration-${index}, 0ms)`
  }
}

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
  const nestedDisplay = useAppStore((s) => s.settings.tableNestedDisplay)
  const columnOrder = useAppStore((s) => getActiveTab(s).tableColumnOrder)
  const setColumnOrder = useAppStore((s) => s.setTableColumnOrder)
  // Document open in the full-document modal editor (null = none).
  const [editIndex, setEditIndex] = useState<number | null>(null)
  const [preview, setPreview] = useState<{
    title: string
    value: unknown
    documentView?: boolean
    documentId?: unknown
    source?: JsonPreviewSource
  } | null>(null)
  // Inline edit: which cell, and whether the last commit failed validation.
  const [editing, setEditing] = useState<{ row: number; col: TableColumn } | null>(null)
  const editingFromMenu = useRef(false)
  const [editError, setEditError] = useState<string | null>(null)
  // Per-column widths (serialized field path → px); unset columns use COL_WIDTH.
  const [colWidths, setColWidths] = useState<Record<string, number>>({})
  const [tableSort, setTableSort] = useState<TableSortState | null>(null)
  const widthOf = (col: TableColumn): number =>
    colWidths[col.id] ?? (col.path[0] === '_id' ? Math.max(COL_WIDTH, Math.ceil(fontSize * 0.61 * 24) + 28) : COL_WIDTH)

  // Selection: a set of whole rows, plus the one "focused" cell that gets an
  // extra overlay highlight on top of its (already selected) row. A single click
  // on any cell selects that whole row and focuses the cell; the # handle selects
  // a row without focusing a cell. Shift extends a row range, ⌘/Ctrl toggles —
  // but no modifier is needed: a plain click already selects the row.
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: TableColumn } | null>(null)
  const selectedRows = selectedDocIndexes
  const [anchorRow, setAnchorRow] = useState<number | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuEntry[] } | null>(null)

  // Drag a header cell's right-edge handle to resize that column.
  const startColResize = (col: TableColumn, e: MouseEvent): void => {
    e.preventDefault()
    const startX = e.clientX
    const startW = widthOf(col)
    const onMove = (ev: globalThis.MouseEvent): void => {
      const w = Math.max(MIN_COL_WIDTH, startW + ev.clientX - startX)
      setColWidths((prev) => ({ ...prev, [col.id]: w }))
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const derivedGroups = useMemo(
    () => deriveTableColumnGroups(docs, nestedDisplay, fieldSort),
    [docs, nestedDisplay, fieldSort]
  )
  const groups = useMemo(() => {
    const byKey = new Map(derivedGroups.map((group) => [group.key, group]))
    return orderTableColumns([...byKey.keys()], columnOrder).map((key) => byKey.get(key)!)
  }, [derivedGroups, columnOrder])
  const columns = useMemo(() => groups.flatMap((group) => group.columns), [groups])
  const hasPinnedId = groups[0]?.key === '_id'
  const groupStyle = (width: number, groupIndex: number): CSSProperties =>
    hasPinnedId && groupIndex === 0
      ? { width, left: INDEX_COL_WIDTH }
      : columnStyle(width, groupIndex - Number(hasPinnedId))
  const headerHeight = (fontSize + 11) * (groups.some((group) => group.columns[0].path.length > 1) ? 2 : 1)
  const moveColumn = useCallback(
    (source: string, target: string) => {
      if (source === target) return
      const next = groups.map((group) => group.key)
      const sourceIndex = next.indexOf(source)
      const targetIndex = next.indexOf(target)
      next.splice(sourceIndex, 1)
      next.splice(targetIndex, 0, source)
      setColumnOrder(next)
    },
    [groups, setColumnOrder]
  )
  useHorizontalReorder(parentRef, JSON.stringify(groups), COLUMN_REORDER, moveColumn)
  const rows = useMemo(() => {
    const column = columns.find((column) => column.id === tableSort?.column)
    const sort = tableSort && column ? { ...tableSort, column: column.path } : null
    return sortTableRows(docs, sort, tableI18n.resolvedLanguage ?? tableI18n.language)
  }, [docs, columns, tableSort, tableI18n.resolvedLanguage, tableI18n.language])

  useEffect(() => {
    onDocumentOrderChange(rows.map((row) => row.sourceIndex))
  }, [onDocumentOrderChange, rows])

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => fontSize + 11,
    overscan: 12
  })

  useEffect(() => rowVirtualizer.measure(), [fontSize, headerHeight, rowVirtualizer])

  useEffect(() => {
    setSelectedCell(null)
    setEditing(null)
    setEditError(null)
    setTableSort(null)
    setMenu(null)
  }, [nestedDisplay])

  // Cmd/Ctrl+C copies the focused cell. Row/document copies live in the context menu.
  useCopyHotkey(() => {
    if (preview) return null
    return tableCellCopyText(docs, selectedCell ? { row: selectedCell.row, col: selectedCell.col.path } : null)
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
  const clickCell = (visibleRow: number, sourceRow: number, col: TableColumn, e: MouseEvent): void => {
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
  const canEditCell = (row: number, col: TableColumn): boolean => {
    if (!docCtx || col.path[0] === '_id') return false
    const doc = docs[row]
    if (!docHasId(doc)) return false
    // A literal dotted key is readable/copyable, but Mongo's ordinary update
    // path syntax would target a nested field instead.
    if (col.path.some((key) => key.includes('.') || key.startsWith('$'))) return false
    const { present, value } = cellValue(doc, col.path)
    return present && editableText(value) != null
  }
  const startEditCell = (row: number, col: TableColumn): void => {
    editingFromMenu.current = true
    setEditError(null)
    setEditing({ row, col })
  }
  const commitCell = async (row: number, col: TableColumn, text: string): Promise<void> => {
    const doc = docs[row]
    if (!docCtx || !docHasId(doc)) return
    const { present, value } = cellValue(doc, col.path)
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
      path: col.path.join('.'),
      valueEjson: JSON.stringify(coerced.value)
    })
    if (res.ok) {
      setEditing(null)
      setEditError(null)
    } else {
      setEditError(res.error ?? t('table.saveFailed'))
    }
  }

  const openMenu = (e: MouseEvent, row: number, col: TableColumn | null): void => {
    e.preventDefault()
    editingFromMenu.current = false
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
    const source: JsonPreviewSource | undefined = docCtx
      ? { ...docCtx, ...(docHasId(doc) ? { id: doc._id } : {}) }
      : undefined
    const items: ContextMenuEntry[] = [
      {
        label: t('result.dataMenu.view'),
        onClick: () => setPreview({ title: t('result.documentPreviewTitle'), value: doc, documentView: true, source })
      }
    ]
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

  const renderColumnHeader = (col: TableColumn): React.JSX.Element => (
    <TableColumnHeader
      key={col.id}
      column={col}
      width={widthOf(col)}
      direction={tableSort?.column === col.id ? tableSort.direction : undefined}
      onResize={(event) => startColResize(col, event)}
      onSort={() =>
        setTableSort((current) => {
          if (current?.column !== col.id) return { column: col.id, direction: 'asc' }
          return current.direction === 'asc' ? { column: col.id, direction: 'desc' } : null
        })
      }
    />
  )

  return (
    <div
      ref={parentRef}
      className={`table-scroller${hasPinnedId ? ' has-pinned-id' : ''}`}
      // Focusable so a grid click claims the ⌘C hotkey: claimCopyFocus moves
      // focus off the query editor AND clears a selection lingering there
      // (user-select:none rows don't collapse it natively — useCopyHotkey would
      // defer to native copy, which copies nothing). Skip when the mousedown
      // lands in the inline cell editor so editing keeps focus.
      tabIndex={-1}
      onMouseDown={(e) => {
        if (!e.currentTarget.contains(e.target as Node)) return
        if (!(e.target as HTMLElement).closest('input, textarea, .cm-editor')) claimCopyFocus(parentRef.current)
      }}
    >
      <div className="tbl" style={{ width: totalWidth, height: rowVirtualizer.getTotalSize() + headerHeight }}>
        {/* Sticky header */}
        <div className="tbl-head" style={{ width: totalWidth, height: headerHeight }}>
          <div className="tbl-th idx" style={{ width: INDEX_COL_WIDTH }}>
            #
          </div>
          {groups.map((group, groupIndex) => (
            <div
              key={group.key}
              className={`tbl-column-group${group.key === '_id' ? ' tbl-pinned-id' : ''}`}
              data-column={group.key}
              style={groupStyle(
                group.columns.reduce((sum, col) => sum + widthOf(col), 0),
                groupIndex
              )}
            >
              {group.columns[0].path.length > 1 ? (
                <>
                  <div className="tbl-group-title" role="columnheader" aria-colspan={group.columns.length}>
                    <Tooltip content={group.key}>
                      <span className="tbl-col-label">{group.key}</span>
                    </Tooltip>
                  </div>
                  <div className="tbl-group-children">{group.columns.map(renderColumnHeader)}</div>
                </>
              ) : (
                renderColumnHeader(group.columns[0])
              )}
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
              style={{ transform: `translateY(${vi.start + headerHeight}px)`, width: totalWidth }}
            >
              <Tooltip content={t('table.selectRowTip')}>
                <div
                  className="tbl-td idx idx-select"
                  style={{ width: INDEX_COL_WIDTH }}
                  onClick={(e) => clickHandle(vi.index, e)}
                  onContextMenu={(e) => openMenu(e, sourceIndex, null)}
                >
                  {vi.index + 1}
                </div>
              </Tooltip>
              {groups.flatMap((group, groupIndex) =>
                group.columns.map((col) => (
                  <Cell
                    key={col.id}
                    doc={doc}
                    column={col}
                    style={groupStyle(widthOf(col), groupIndex)}
                    selected={selectedCell?.row === sourceIndex && selectedCell?.col.id === col.id}
                    editing={editing?.row === sourceIndex && editing?.col.id === col.id}
                    editError={editError}
                    openPreviewHint={t('table.doubleClickForFullInfo')}
                    onClick={(e) => clickCell(vi.index, sourceIndex, col, e)}
                    onOpen={(value) =>
                      setPreview({
                        title: col.path.join('.'),
                        value,
                        documentId: docHasId(doc) ? doc._id : undefined,
                        source: docCtx
                          ? { ...docCtx, ...(docHasId(doc) ? { id: doc._id } : {}), field: col.path }
                          : undefined
                      })
                    }
                    onCommit={(text) => void commitCell(sourceIndex, col, text)}
                    onCancel={() => {
                      setEditing(null)
                      setEditError(null)
                    }}
                    onContextMenu={(e) => openMenu(e, sourceIndex, col)}
                  />
                ))
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

      {preview && (
        <JsonPreviewModal
          title={preview.title}
          value={preview.value}
          fontSize={fontSize}
          documentView={preview.documentView}
          documentId={preview.documentId}
          source={preview.source}
          onValueChange={(value) => setPreview((current) => (current ? { ...current, value } : current))}
          onClose={() => setPreview(null)}
        />
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menu.items}
          onClose={() => setMenu(null)}
          finalFocus={() => !editingFromMenu.current}
        />
      )}
    </div>
  )
}

function TableColumnHeader({
  column,
  width,
  direction,
  onSort,
  onResize
}: {
  column: TableColumn
  width: number
  direction?: TableSortDirection
  onSort: () => void
  onResize: (event: MouseEvent) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const label = t(
    direction === undefined ? 'table.sortAscending' : direction === 'asc' ? 'table.sortDescending' : 'table.clearSort',
    {
      column: column.path.join('.')
    }
  )
  return (
    <div
      className="tbl-th"
      data-column-path={column.id}
      style={{ width }}
      role="columnheader"
      aria-sort={direction === undefined ? 'none' : direction === 'asc' ? 'ascending' : 'descending'}
    >
      <Tooltip content={label}>
        <button
          type="button"
          className={`tbl-sort-trigger${direction ? ' active' : ''}`}
          aria-label={label}
          onClick={onSort}
        >
          <span className="tbl-col-label">{column.label}</span>
          {direction === 'asc' ? (
            <ArrowUp size={13} aria-hidden="true" />
          ) : direction === 'desc' ? (
            <ArrowDown size={13} aria-hidden="true" />
          ) : (
            <ChevronsUpDown size={13} className="tbl-sort-idle" aria-hidden="true" />
          )}
        </button>
      </Tooltip>
      <span className="tbl-col-resizer" onMouseDown={onResize} />
    </div>
  )
}

function exportMenuItems(
  documents: unknown[],
  onExport: (format: ResultExportFormat, documents: unknown[], jsonEncoding?: JsonEncoding) => void
): ContextMenuEntry[] {
  return resultExportMenuItems(documents, onExport)
}

/** Right-click copy menu for a table cell / row(s). */
function tableCopyMenuItems(
  rows: number[],
  row: number,
  col: TableColumn | null,
  docs: unknown[],
  fieldSort: CollectionSort
): ContextMenuEntry[] {
  const cell = col == null ? { present: false, value: undefined } : cellValue(docs[row], col.path)
  const hasValue = col != null && cell.present
  const single = docs[row]
  const sel = rows.map((i) => docs[i]) // effective rows: the multi-selection, or just this row
  const many = rows.length > 1
  const formatted = many ? sel : single
  return [
    {
      label: i18n.t('result.dataMenu.copyKey'),
      disabled: col == null,
      onClick: () => void copyText(col?.path.join('.') ?? '')
    },
    {
      label: i18n.t('result.dataMenu.copyValue'),
      disabled: !hasValue,
      onClick: () => void copyText(plainScalarText(cell.value))
    },
    {
      label: i18n.t('result.dataMenu.copyKeyValue'),
      disabled: !hasValue,
      onClick: () => void copyText(toPlainKeyValue(col?.path.join('.') ?? '', cell.value))
    },
    'separator',
    {
      label: i18n.t('result.dataMenu.copySelectedDocuments'),
      children: [
        ...jsonCopyMenuItems(sel, (text) => void copyText(text)),
        {
          label: i18n.t('result.dataMenu.copyMongoShell'),
          onClick: () => void copyText(toShellText(formatted))
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
  ]
}

function Cell({
  doc,
  column,
  style,
  selected,
  editing,
  editError,
  openPreviewHint,
  onClick,
  onOpen,
  onCommit,
  onCancel,
  onContextMenu
}: {
  doc: unknown
  column: TableColumn
  style: CSSProperties
  selected: boolean
  editing: boolean
  editError: string | null
  openPreviewHint: string
  onClick: (e: MouseEvent) => void
  onOpen: (value: unknown) => void
  onCommit: (text: string) => void
  onCancel: () => void
  onContextMenu: (e: MouseEvent) => void
}): React.JSX.Element {
  const { present, value } = cellValue(doc, column.path)
  const cellCls = `tbl-td${column.path[0] === '_id' ? ' tbl-pinned-id' : ''}${selected ? ' selected' : ''}`

  if (editing) {
    return (
      <div className={cellCls} style={style}>
        <CellInput initial={editableText(value) ?? ''} error={editError} onCommit={onCommit} onCancel={onCancel} />
      </div>
    )
  }

  if (!present) {
    return (
      <div className={cellCls} style={style} onClick={onClick} onContextMenu={onContextMenu}>
        <span className="empty">—</span>
      </div>
    )
  }
  const expandable = Array.isArray(value) || (isPlainObject(value) && !isExtended(value))
  const tokens = expandable ? toInlineJsonTokens(value) : null
  const scalar = tokens ? null : formatScalar(value)
  return (
    <Tooltip
      content={expandable ? () => formatJsonPreview(value).text : scalar!.text}
      footer={expandable ? openPreviewHint : undefined}
      variant={expandable ? 'code' : 'compact'}
    >
      <div
        className={cellCls}
        style={{ ...style, cursor: expandable ? 'pointer' : undefined }}
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
        {tokens ? (
          tokens.map((token, index) => (
            <span key={index} className={token.cls}>{token.text}</span>
          ))
        ) : (
          <span className={`v-${scalar!.type}`}>
            {column.path[0] === '_id' && scalar!.type === 'objectId' ? plainScalarText(value) : scalar!.text}
          </span>
        )}
      </div>
    </Tooltip>
  )
}
