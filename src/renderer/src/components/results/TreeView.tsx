import { useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { entriesOf, formatScalar, isExpandable, summarize } from '@renderer/lib/ejson'
import { confirmDeleteDoc, docHasId, type DocActionContext } from '@renderer/lib/docActions'
import { DocEditor } from './DocEditor'

/**
 * Virtualized, lazily-expanding tree of the result documents.
 *
 * VIRTUALIZATION APPROACH (ADR-0004 rule 1):
 *  - We never render the whole nested tree as DOM. Instead we FLATTEN only the
 *    currently-visible nodes into a single `FlatNode[]` array. A node's children
 *    are appended to the flat list ONLY when that node is in the `expanded` set,
 *    so collapsed subtrees cost nothing (lazy expansion, rule 1's "render nested
 *    children only on expand").
 *  - That flat array is fed to `useVirtualizer`, which keeps only the visible
 *    rows (+ small overscan) in the DOM regardless of total node count.
 *  - The flatten pass is memoized on (docs identity, expanded set), so typing /
 *    re-renders don't re-walk the tree unless something actually changed.
 *
 * Each top-level array index is a collapsible "document" row.
 */

interface FlatNode {
  /** Stable path id, e.g. "0.address.city". */
  id: string
  depth: number
  /** Display key (array index or field name); empty for the synthetic root rows. */
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

export function TreeView({ docs, docCtx }: TreeViewProps): JSX.Element {
  const parentRef = useRef<HTMLDivElement>(null)
  // Index of the document currently being edited (null = none).
  const [editIndex, setEditIndex] = useState<number | null>(null)
  // Expanded paths. Top-level docs start collapsed except the first for context.
  const [expanded, setExpanded] = useState<Set<string>>(() => (docs.length > 0 ? new Set(['0']) : new Set()))

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
        for (const [childKey, childVal] of entriesOf(value)) {
          walk(childKey, childVal, depth + 1, `${path}.${childKey}`)
        }
      }
    }
    docs.forEach((doc, i) => walk(`(${i})`, doc, 0, String(i), i))
    return out
  }, [docs, expanded])

  const rowVirtualizer = useVirtualizer({
    count: flat.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12
  })

  if (docs.length === 0) {
    return <div className="center-msg muted">No documents.</div>
  }

  const editDoc = editIndex !== null ? docs[editIndex] : undefined
  const canEdit = docCtx != null

  return (
    <div ref={parentRef} className="virtual-scroller">
      <div className="virtual-inner" style={{ height: rowVirtualizer.getTotalSize() }}>
        {rowVirtualizer.getVirtualItems().map((vi) => {
          const node = flat[vi.index]
          const showActions =
            canEdit && node.depth === 0 && node.docIndex !== undefined && docHasId(node.value)
          return (
            <div
              key={node.id}
              className="vrow tree-row"
              style={{
                transform: `translateY(${vi.start}px)`,
                paddingLeft: 6 + node.depth * 14
              }}
            >
              <span
                className="twisty"
                onClick={() => node.expandable && toggle(node.id)}
                style={{ cursor: node.expandable ? 'pointer' : 'default' }}
              >
                {node.expandable ? (node.expanded ? '▾' : '▸') : ''}
              </span>
              <NodeContent node={node} />
              {showActions && docCtx && (
                <span className="row-actions">
                  <button className="ghost row-act" title="Edit document" onClick={() => setEditIndex(node.docIndex ?? null)}>
                    ✎
                  </button>
                  <button
                    className="ghost row-act danger"
                    title="Delete document"
                    onClick={() => void confirmDeleteDoc(docCtx, (node.value as { _id: unknown })._id)}
                  >
                    🗑
                  </button>
                </span>
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

function NodeContent({ node }: { node: FlatNode }): JSX.Element {
  const keyEl =
    node.depth === 0 ? (
      <span className="doc-badge">{node.keyLabel}</span>
    ) : (
      <>
        <span className="tree-key">{node.keyLabel}</span>
        <span className="tree-colon">:</span>
      </>
    )

  if (node.expandable && node.expanded) {
    // Open container: show just the opening bracket-ish summary marker.
    return (
      <>
        {keyEl}
        <span className="tree-summary">{Array.isArray(node.value) ? '[' : '{'}</span>
      </>
    )
  }

  if (node.expandable) {
    return (
      <>
        {keyEl}
        <span className="tree-summary">{summarize(node.value)}</span>
      </>
    )
  }

  // Leaf: scalar / EJSON extended type. `type` already encodes the semantic
  // value type used for color-coding (see formatScalar/valueType).
  const { text, type } = formatScalar(node.value)
  return (
    <>
      {keyEl}
      <span className={`tree-val v-${type}`} title={text}>
        {text}
      </span>
    </>
  )
}
