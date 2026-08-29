import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { CollectionSort, TabularExportFormat } from '@shared/types'
import { entriesOf, formatScalar, isExpandable, summarize, typeLabel, valueType } from '@renderer/lib/ejson'
import { coerceEdit, editableText } from '@renderer/lib/cellEdit'
import { confirmDeleteDoc, docHasId, type DocActionContext } from '@renderer/lib/docActions'
import { computeSelection } from '@renderer/lib/selection'
import { useAppStore } from '@renderer/store/useAppStore'
import { ContextMenu, type ContextMenuEntry } from '@renderer/components/ContextMenu'
import {
  copyText,
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
import { JsonPreviewModal, type JsonPreviewSource } from './JsonPreviewModal'
import { Tooltip } from '@renderer/components/ui/Tooltip'

/**
 * Two-column KEY | VALUE tree of the result documents.
 *
 * Each row is an aligned pair: the field name (left, indented by depth) and its
 * value (right). Each top-level array index is a collapsible "document" row, and
 * nested objects/arrays collapse by default — double-click a row (or click its
 * twisty) to expand/collapse. A draggable divider sets the key-column width so
 * keys and values line up in two clean columns.
 *
 * VIRTUALIZATION APPROACH:
 *  - We never render the whole nested tree as DOM. Instead we FLATTEN only the
 *    currently-visible nodes into a single `FlatNode[]` array. A node's children
 *    are appended ONLY when that node is in the `expanded` set, so collapsed
 *    subtrees cost nothing (lazy expansion).
 *  - That flat array feeds `useVirtualizer`, which keeps only the visible rows
 *    (+ small overscan) in the DOM regardless of total node count.
 *  - The flatten pass is memoized on (docs identity, expanded set), so typing /
 *    re-renders don't re-walk the tree unless something actually changed.
 */

interface FlatNode {
  /** Stable path id, e.g. "0.address.city". */
  id: string
  depth: number
  /** Array index or field name; the synthetic doc rows use "(0)". */
  keyLabel: string
  value: unknown
  expandable: boolean
  expanded: boolean
  /** Top-level document index (only set for depth-0 rows). */
  docIndex?: number
}

interface TreeViewProps {
  docs: unknown[]
  fontSize: number
  selectedDocIndexes: Set<number>
  onSelectedDocIndexesChange: (selection: Set<number>) => void
  onExport: (format: TabularExportFormat, documents: unknown[]) => void
  /** When set, top-level docs with an _id get Edit/Delete actions. */
  docCtx?: DocActionContext | null
}

const DEFAULT_KEY_WIDTH = 280
const MIN_KEY_WIDTH = 120
const MAX_KEY_WIDTH = 680

export function TreeView({
  docs,
  fontSize,
  selectedDocIndexes,
  onSelectedDocIndexesChange,
  onExport,
  docCtx
}: TreeViewProps): React.JSX.Element {
  const { t } = useTranslation()
  const parentRef = useRef<HTMLDivElement>(null)
  const setDocumentField = useAppStore((s) => s.setDocumentField)
  const fieldSort = useAppStore((s) => s.settings.collectionSort)
  // Index of the document open in the full-document modal editor (null = none).
  const [editIndex, setEditIndex] = useState<number | null>(null)
  const [previewDoc, setPreviewDoc] = useState<{ value: unknown; source?: JsonPreviewSource } | null>(null)
  // Inline edit: which leaf node is being edited, and whether the last commit
  // failed validation (red border).
  const [editing, setEditing] = useState<{ id: string } | null>(null)
  const [editError, setEditError] = useState<string | null>(null)
  // Expanded paths. Top-level docs start collapsed except the first (for
  // context); nested containers always start collapsed.
  const [expanded, setExpanded] = useState<Set<string>>(() => (docs.length > 0 ? new Set(['0']) : new Set()))
  const [keyWidth, setKeyWidth] = useState(DEFAULT_KEY_WIDTH)
  // Click-to-select: the selected node is highlighted and is what Cmd+C copies.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Multi-select of TOP-LEVEL documents (depth-0 rows), mirroring the Table's
  // row multi-select: Shift = range, ⌘/Ctrl = toggle. Mutually exclusive with
  // the single-node `selectedId` — selecting one clears the other.
  const selectedDocs = selectedDocIndexes
  const [anchorDoc, setAnchorDoc] = useState<number | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuEntry[] } | null>(null)

  const toggle = (id: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Flatten visible nodes. Memo keyed by docs identity + expanded set reference.
  const flat = useMemo<FlatNode[]>(() => {
    const out: FlatNode[] = []
    const walk = (key: string, value: unknown, depth: number, path: string, docIndex?: number): void => {
      const canExpand = isExpandable(value)
      const isOpen = canExpand && expanded.has(path)
      out.push({
        id: path,
        depth,
        keyLabel: key,
        value,
        expandable: canExpand,
        expanded: isOpen,
        docIndex
      })
      if (isOpen) {
        for (const [childKey, childVal] of entriesOf(value, fieldSort)) {
          walk(childKey, childVal, depth + 1, `${path}.${childKey}`)
        }
      }
    }
    // Display badge is 1-based for humans; the path id stays 0-based (it keys
    // expand state and child paths).
    docs.forEach((doc, i) => walk(`(${i + 1})`, doc, 0, String(i), i))
    return out
  }, [docs, expanded, fieldSort])

  const rowVirtualizer = useVirtualizer({
    count: flat.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => fontSize + 11,
    overscan: 12
  })

  useEffect(() => rowVirtualizer.measure(), [fontSize, rowVirtualizer])

  // Drag the divider to resize the key column.
  const startResize = useCallback(
    (e: MouseEvent): void => {
      e.preventDefault()
      const startX = e.clientX
      const startW = keyWidth
      const onMove = (ev: globalThis.MouseEvent): void => {
        const w = Math.min(MAX_KEY_WIDTH, Math.max(MIN_KEY_WIDTH, startW + ev.clientX - startX))
        setKeyWidth(w)
      }
      const onUp = (): void => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [keyWidth]
  )

  // Cmd/Ctrl+C copies the selected node: a leaf's value (plain), or an
  // expandable node / whole document as plain JSON.
  useCopyHotkey(() => {
    if (previewDoc) return null
    if (selectedDocs.size > 0) {
      const picked = [...selectedDocs].sort((a, b) => a - b).map((i) => docs[i])
      return picked.length === 1 ? toPlainJson(picked[0]) : toPlainJson(picked)
    }
    if (!selectedId) return null
    const node = flat.find((n) => n.id === selectedId)
    if (!node) return null
    return node.expandable ? toPlainJson(node.value) : plainScalarText(node.value)
  })

  const rootDocOf = (node: FlatNode): unknown => docs[Number(node.id.split('.')[0])]
  const fieldPathOf = (node: FlatNode): string => node.id.split('.').slice(1).join('.')

  // A row is highlighted when its top-level doc is in the multi-doc selection
  // (depth-0 rows only), or when it's the single selected nested node.
  const isRowSelected = (node: FlatNode): boolean =>
    node.depth === 0 ? node.docIndex !== undefined && selectedDocs.has(node.docIndex) : node.id === selectedId

  // Click a row. Top-level document rows drive the multi-doc selection: plain =
  // just this doc, Shift = range from the anchor, ⌘/Ctrl = toggle. Clicking any
  // nested node falls back to single-node selection.
  const onRowClick = (node: FlatNode, e: MouseEvent): void => {
    if (node.depth === 0 && node.docIndex !== undefined) {
      const i = node.docIndex
      setSelectedId(null)
      const { selection, anchor } = computeSelection(selectedDocs, i, anchorDoc, {
        shift: e.shiftKey,
        meta: e.metaKey,
        ctrl: e.ctrlKey
      })
      onSelectedDocIndexesChange(selection)
      setAnchorDoc(anchor)
    } else {
      setSelectedId(node.id)
      onSelectedDocIndexesChange(new Set())
      setAnchorDoc(null)
    }
  }

  // A leaf is inline-editable when we know the collection, the doc has an _id,
  // the field isn't _id, and the value is a supported scalar type.
  const canEditNode = (node: FlatNode): boolean =>
    docCtx != null &&
    node.depth > 0 &&
    fieldPathOf(node) !== '_id' &&
    editableText(node.value) != null &&
    docHasId(rootDocOf(node))

  const startEdit = (node: FlatNode): void => {
    setEditError(null)
    setEditing({ id: node.id })
  }

  const commitEdit = async (node: FlatNode, text: string): Promise<void> => {
    const rootDoc = rootDocOf(node)
    if (!docCtx || !docHasId(rootDoc)) return
    const coerced = coerceEdit(node.value, text)
    if ('error' in coerced) {
      setEditError(coerced.error)
      return
    }
    const res = await setDocumentField({
      connectionId: docCtx.connectionId,
      database: docCtx.database,
      collection: docCtx.collection,
      id: rootDoc._id,
      path: fieldPathOf(node),
      valueEjson: JSON.stringify(coerced.value)
    })
    if (res.ok) {
      setEditing(null)
      setEditError(null)
    } else {
      setEditError(res.error ?? t('tree.saveFailed'))
    }
  }

  const openMenu = (e: MouseEvent, node: FlatNode): void => {
    e.preventDefault()
    const isDocRow = node.depth === 0 && node.docIndex !== undefined
    const inMultiDoc = isDocRow && selectedDocs.has(node.docIndex as number)
    // Right-clicking outside the current selection refocuses on this node/doc;
    // right-clicking inside a multi-doc selection keeps it (for a bulk copy).
    if (!inMultiDoc) {
      if (isDocRow) {
        onSelectedDocIndexesChange(new Set([node.docIndex as number]))
        setSelectedId(null)
        setAnchorDoc(node.docIndex as number)
      } else {
        setSelectedId(node.id)
        onSelectedDocIndexesChange(new Set())
        setAnchorDoc(null)
      }
    }
    const picked = [...selectedDocs].sort((a, b) => a - b)
    const rootDoc = rootDocOf(node)
    const selected = inMultiDoc && picked.length > 1 ? picked.map((index) => docs[index]) : [rootDoc]
    const source: JsonPreviewSource | undefined = docCtx
      ? { ...docCtx, ...(docHasId(rootDoc) ? { id: rootDoc._id } : {}) }
      : undefined
    const items: ContextMenuEntry[] = [
      {
        label: t('result.dataMenu.view'),
        onClick: () => setPreviewDoc({ value: rootDoc, source })
      }
    ]
    if (docCtx && docHasId(rootDoc)) {
      const rootIndex = Number(node.id.split('.')[0])
      items.push({
        label: t('result.dataMenu.edit'),
        children: [
          { label: t('tree.editDoc'), onClick: () => setEditIndex(rootIndex) },
          {
            label: t('tree.editCell'),
            disabled: !canEditNode(node),
            onClick: () => startEdit(node)
          }
        ]
      })
    }
    items.push({
      label: t('result.dataMenu.copy'),
      children: treeCopyMenuItems(node, selected, fieldSort)
    })
    items.push({
      label: t('result.dataMenu.export'),
      children: exportMenuItems(selected, onExport)
    })
    if (docCtx && docHasId(rootDoc)) {
      items.push('separator')
      items.push({
        label: t('tree.deleteDoc'),
        danger: true,
        onClick: () => void confirmDeleteDoc(docCtx, rootDoc._id)
      })
    }
    setMenu({ x: e.clientX, y: e.clientY, items })
  }

  if (docs.length === 0) {
    return <div className="center-msg muted">{t('tree.noDocuments')}</div>
  }

  const editDoc = editIndex !== null ? docs[editIndex] : undefined

  return (
    <div
      ref={parentRef}
      className="virtual-scroller"
      // Focusable so a grid click claims the ⌘C hotkey: claimCopyFocus moves
      // focus off the query editor AND clears a selection lingering there
      // (user-select:none rows don't collapse it natively — useCopyHotkey would
      // defer to native copy, which copies nothing). Skip when the mousedown
      // lands in the inline cell editor so editing keeps focus.
      tabIndex={-1}
      onMouseDown={(e) => {
        if (!(e.target as HTMLElement).closest('input, textarea, .cm-editor')) claimCopyFocus(parentRef.current)
      }}
    >
      <div className="virtual-inner" style={{ height: rowVirtualizer.getTotalSize() }}>
        <div className="kv-resizer" style={{ left: keyWidth }} onMouseDown={startResize} />
        {rowVirtualizer.getVirtualItems().map((vi) => {
          const node = flat[vi.index]
          const isEditing = editing?.id === node.id
          return (
            <div
              key={node.id}
              className={`kv-row${node.expandable ? ' expandable' : ''}${isRowSelected(node) ? ' selected' : ''}`}
              style={{ transform: `translateY(${vi.start}px)` }}
              onClick={(e) => onRowClick(node, e)}
              onDoubleClick={() => node.expandable && toggle(node.id)}
              onContextMenu={(e) => openMenu(e, node)}
            >
              <div className="kv-key" style={{ width: keyWidth, paddingLeft: 6 + node.depth * 14 }}>
                <span
                  className="twisty"
                  onClick={(e) => {
                    if (node.expandable) {
                      e.stopPropagation()
                      toggle(node.id)
                    }
                  }}
                  style={{ cursor: node.expandable ? 'pointer' : 'default' }}
                >
                  {node.expandable ? (node.expanded ? '▾' : '▸') : ''}
                </span>
                {node.depth === 0 ? (
                  <span className="doc-badge">{node.keyLabel}</span>
                ) : (
                  <Tooltip content={node.keyLabel}>
                    <span className="kv-key-name">{node.keyLabel}</span>
                  </Tooltip>
                )}
              </div>
              <div className="kv-val">
                {isEditing ? (
                  <CellInput
                    initial={editableText(node.value) ?? ''}
                    error={editError}
                    onCommit={(text) => void commitEdit(node, text)}
                    onCancel={() => {
                      setEditing(null)
                      setEditError(null)
                    }}
                  />
                ) : (
                  <ValueCell node={node} />
                )}
              </div>
              <div className={`kv-type v-${valueType(node.value)}`}>
                {node.depth === 0 ? t('tree.documentType') : typeLabel(node.value)}
              </div>
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

      {previewDoc && (
        <JsonPreviewModal
          title={t('result.documentPreviewTitle')}
          value={previewDoc.value}
          fontSize={fontSize}
          documentView
          source={previewDoc.source}
          onValueChange={(value) => setPreviewDoc((current) => (current ? { ...current, value } : current))}
          onClose={() => setPreviewDoc(null)}
        />
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
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

/** Right-click copy submenu for a tree field / document selection. */
function treeCopyMenuItems(node: FlatNode, docs: unknown[], fieldSort: CollectionSort): ContextMenuEntry[] {
  const hasField = node.depth > 0
  const valueText = node.expandable ? toPlainJson(node.value) : plainScalarText(node.value)
  const formatted = docs.length > 1 ? docs : docs[0]
  return [
    {
      label: i18n.t('result.dataMenu.copyKey'),
      disabled: !hasField,
      onClick: () => void copyText(node.keyLabel)
    },
    {
      label: i18n.t('result.dataMenu.copyValue'),
      disabled: !hasField,
      onClick: () => void copyText(valueText)
    },
    {
      label: i18n.t('result.dataMenu.copyKeyValue'),
      disabled: !hasField,
      onClick: () => void copyText(toPlainKeyValue(node.keyLabel, node.value))
    },
    'separator',
    {
      label: i18n.t('result.dataMenu.copySelectedDocuments'),
      children: [
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
          onClick: () => void copyText(toCsv(docs, fieldSort))
        },
        {
          label: i18n.t('result.dataMenu.copyTsv'),
          onClick: () => void copyText(toTsv(docs, fieldSort))
        }
      ]
    }
  ]
}

function ValueCell({ node }: { node: FlatNode }): React.JSX.Element {
  if (node.expandable) {
    // Containers show a compact summary (`{ 11 fields }` / `[ 3 ]`) whether open
    // or closed; their children render as indented rows below.
    return <span className="tree-summary">{summarize(node.value)}</span>
  }
  // Leaf: scalar / EJSON extended type; `type` drives the color class.
  const { text, type } = formatScalar(node.value)
  return (
    <Tooltip content={text}>
      <span className={`tree-val v-${type}`}>{text}</span>
    </Tooltip>
  )
}
