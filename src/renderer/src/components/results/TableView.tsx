import { useMemo, useRef, useState, type MouseEvent } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { formatScalar, isExtended, summarize } from '@renderer/lib/ejson'
import { confirmDeleteDoc, docHasId, type DocActionContext } from '@renderer/lib/docActions'
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
              className="tbl-row"
              style={{ transform: `translateY(${vi.start + ROW_HEIGHT}px)`, width: totalWidth }}
            >
              <div className="tbl-td idx" style={{ width: INDEX_COL_WIDTH }}>
                {vi.index + 1}
              </div>
              {columns.map((col) => (
                <Cell key={col} doc={doc} column={col} width={widthOf(col)} />
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
    </div>
  )
}

function Cell({
  doc,
  column,
  width
}: {
  doc: unknown
  column: string
  width: number
}): JSX.Element {
  const { present, value } = cellValue(doc, column)
  if (!present) {
    return (
      <div className="tbl-td" style={{ width }}>
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
    <div className="tbl-td" style={{ width }} title={text}>
      <span className={cls}>{text}</span>
    </div>
  )
}
