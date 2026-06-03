import { useCallback, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { entriesOf, formatScalar, isExpandable, summarize, typeLabel } from '@renderer/lib/ejson'
import { coerceEdit, editableText } from '@renderer/lib/cellEdit'
import { confirmDeleteDoc, docHasId, type DocActionContext } from '@renderer/lib/docActions'
import { useAppStore } from '@renderer/store/useAppStore'
import { ContextMenu, type ContextMenuItem } from '@renderer/components/ContextMenu'
import {
  copyText,
  plainScalarText,
  toPlainJson,
  toPlainValue,
  toShellText,
  toStrictEjson
} from '@renderer/lib/resultCopy'
import { useCopyHotkey } from '@renderer/lib/useCopyHotkey'
import { CellInput } from './CellInput'
import { DocEditor } from './DocEditor'

/**
 * Two-column KEY | VALUE tree of the result documents.
 *
 * Each row is an aligned pair: the field name (left, indented by depth) and its
 * value (right). Each top-level array index is a collapsible "document" row, and
 * nested objects/arrays collapse by default — double-click a row (or click its
 * twisty) to expand/collapse. A draggable divider sets the key-column width so
 * keys and values line up in two clean columns.
 *
 * VIRTUALIZATION APPROACH (ADR-0004 rule 1):
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
  /** When set, top-level docs with an _id get Edit/Delete actions. */
  docCtx?: DocActionContext | null
}

const ROW_HEIGHT = 24
const DEFAULT_KEY_WIDTH = 280
const MIN_KEY_WIDTH = 120
const MAX_KEY_WIDTH = 680

export function TreeView({ docs, docCtx }: TreeViewProps): JSX.Element {
  const parentRef = useRef<HTMLDivElement>(null)
  const setDocumentField = useAppStore((s) => s.setDocumentField)
  // Index of the document open in the full-document modal editor (null = none).
  const [editIndex, setEditIndex] = useState<number | null>(null)
  // Inline edit: which leaf node is being edited, and whether the last commit
  // failed validation (red border).
  const [editing, setEditing] = useState<{ id: string } | null>(null)
  const [editError, setEditError] = useState<string | null>(null)
  // Expanded paths. Top-level docs start collapsed except the first (for
  // context); nested containers always start collapsed.
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    docs.length > 0 ? new Set(['0']) : new Set()
  )
  const [keyWidth, setKeyWidth] = useState(DEFAULT_KEY_WIDTH)
  // Click-to-select: the selected node is highlighted and is what Cmd+C copies.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null)

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
    const walk = (
      key: string,
      value: unknown,
      depth: number,
      path: string,
      docIndex?: number
    ): void => {
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
        for (const [childKey, childVal] of entriesOf(value)) {
          walk(childKey, childVal, depth + 1, `${path}.${childKey}`)
        }
      }
    }
    // Display badge is 1-based for humans; the path id stays 0-based (it keys
    // expand state and child paths).
    docs.forEach((doc, i) => walk(`(${i + 1})`, doc, 0, String(i), i))
    return out
  }, [docs, expanded])

  const rowVirtualizer = useVirtualizer({
    count: flat.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12
  })

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
    if (!selectedId) return null
    const node = flat.find((n) => n.id === selectedId)
    if (!node) return null
    return node.expandable ? toPlainJson(node.value) : plainScalarText(node.value)
  })

  const rootDocOf = (node: FlatNode): unknown => docs[Number(node.id.split('.')[0])]
  const fieldPathOf = (node: FlatNode): string => node.id.split('.').slice(1).join('.')

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
      setEditError(res.error ?? '保存失败')
    }
  }

  const openMenu = (e: MouseEvent, node: FlatNode): void => {
    e.preventDefault()
    setSelectedId(node.id)
    const items = treeMenuItems(node, docs)
    const rootDoc = rootDocOf(node)
    if (docCtx && docHasId(rootDoc)) {
      const rootIndex = Number(node.id.split('.')[0])
      items.push({ label: '编辑文档…', onClick: () => setEditIndex(rootIndex) })
      items.push({
        label: '删除文档',
        danger: true,
        onClick: () => void confirmDeleteDoc(docCtx, rootDoc._id)
      })
    }
    setMenu({ x: e.clientX, y: e.clientY, items })
  }

  if (docs.length === 0) {
    return <div className="center-msg muted">No documents.</div>
  }

  const editDoc = editIndex !== null ? docs[editIndex] : undefined

  return (
    <div ref={parentRef} className="virtual-scroller">
      <div className="virtual-inner" style={{ height: rowVirtualizer.getTotalSize() }}>
        <div className="kv-resizer" style={{ left: keyWidth }} onMouseDown={startResize} />
        {rowVirtualizer.getVirtualItems().map((vi) => {
          const node = flat[vi.index]
          const isEditing = editing?.id === node.id
          return (
            <div
              key={node.id}
              className={`kv-row${node.expandable ? ' expandable' : ''}${
                node.id === selectedId ? ' selected' : ''
              }`}
              style={{ transform: `translateY(${vi.start}px)` }}
              onClick={() => setSelectedId(node.id)}
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
                  <span className="kv-key-name" title={node.keyLabel}>
                    {node.keyLabel}
                  </span>
                )}
              </div>
              <div
                className="kv-val"
                onDoubleClick={(e) => {
                  if (canEditNode(node)) {
                    e.stopPropagation()
                    startEdit(node)
                  }
                }}
              >
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
              <div className="kv-type">{node.depth === 0 ? 'Document' : typeLabel(node.value)}</div>
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

/** Right-click copy menu for a tree node (value / key / field / document). */
function treeMenuItems(node: FlatNode, docs: unknown[]): ContextMenuItem[] {
  const rootDoc = docs[Number(node.id.split('.')[0])]
  if (node.depth === 0) {
    return [
      { label: '复制文档 (Pure JSON)', onClick: () => void copyText(toPlainJson(node.value)) },
      { label: '复制文档 (MongoShell JS)', onClick: () => void copyText(toShellText(node.value)) },
      { label: '复制文档 (Extended JSON)', onClick: () => void copyText(toStrictEjson(node.value)) }
    ]
  }
  const valueText = node.expandable ? toPlainJson(node.value) : plainScalarText(node.value)
  const fieldJson = node.expandable ? toPlainJson(node.value) : JSON.stringify(toPlainValue(node.value))
  return [
    { label: '复制值', onClick: () => void copyText(valueText) },
    { label: '复制键', onClick: () => void copyText(node.keyLabel) },
    { label: '复制字段', onClick: () => void copyText(`${JSON.stringify(node.keyLabel)}: ${fieldJson}`) },
    { label: '复制所在文档 (Pure JSON)', onClick: () => void copyText(toPlainJson(rootDoc)) },
    { label: '复制所在文档 (MongoShell JS)', onClick: () => void copyText(toShellText(rootDoc)) },
    { label: '复制所在文档 (Extended JSON)', onClick: () => void copyText(toStrictEjson(rootDoc)) }
  ]
}

function ValueCell({ node }: { node: FlatNode }): JSX.Element {
  if (node.expandable) {
    // Containers show a compact summary (`{ 11 fields }` / `[ 3 ]`) whether open
    // or closed; their children render as indented rows below.
    return <span className="tree-summary">{summarize(node.value)}</span>
  }
  // Leaf: scalar / EJSON extended type; `type` drives the color class.
  const { text, type } = formatScalar(node.value)
  return (
    <span className={`tree-val v-${type}`} title={text}>
      {text}
    </span>
  )
}
