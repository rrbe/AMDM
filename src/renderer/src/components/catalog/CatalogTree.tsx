import { useMemo, useState } from 'react'
import { useAppStore, type CatalogState, type NodeKind, type NodePayload } from '@renderer/store/useAppStore'
import { formatScalar } from '@renderer/lib/ejson'
import type { CollectionSort } from '@shared/types'
import { ExportModal } from '@renderer/components/io/ExportModal'
import { ImportModal } from '@renderer/components/io/ImportModal'

/**
 * Lazy catalog tree for the active connected connection:
 *   Databases → Collections → (Indexes, Users) → leaves
 *
 * Children are loaded on expand via catalog.* and cached in the store. We build
 * a *flat* list of currently-visible rows from the expanded-node set so the
 * render is simple; the tree is small (one connection's catalog) so a plain
 * scroll container is fine here — the big virtualization happens in the results.
 *
 * ADR-0004 rule 5: clicking a collection does NOT auto-run a query; it only
 * sets the active db and seeds the editor with `db.<coll>.find({})`.
 */

interface Row {
  id: string
  depth: number
  label: string
  /** A glyph hint for the row type. */
  icon: string
  kind: NodeKind | 'leaf' | 'folder'
  expandable: boolean
  expanded: boolean
  loading: boolean
  count?: number
  /** Present on collection rows: enables the Export/Import hover actions. */
  collection?: { db: string; name: string }
  onClick?: () => void
  onToggle?: () => void
}

/** Which import/export modal (if any) is open, and for which collection. */
type IoModal = { mode: 'export' | 'import'; db: string; collection: string } | null

export function CatalogTree(): JSX.Element {
  const activeConnectionId = useAppStore((s) => s.activeConnectionId)
  const statuses = useAppStore((s) => s.statuses)
  const catalogs = useAppStore((s) => s.catalogs)
  const connections = useAppStore((s) => s.connections)
  const toggleNode = useAppStore((s) => s.toggleNode)
  const insertSnippet = useAppStore((s) => s.insertSnippet)
  const collectionSort = useAppStore((s) => s.settings.collectionSort)
  const updateSettings = useAppStore((s) => s.updateSettings)

  const [ioModal, setIoModal] = useState<IoModal>(null)

  const connected =
    activeConnectionId !== null && statuses[activeConnectionId]?.state === 'connected'

  const catalog = activeConnectionId ? catalogs[activeConnectionId] : undefined
  const connName = connections.find((c) => c.id === activeConnectionId)?.name ?? ''

  // Build the flat visible-row list from the expanded set. Recomputed only when
  // the catalog snapshot, active connection, or sort preference changes.
  const rows = useMemo<Row[]>(() => {
    if (!activeConnectionId || !connected || !catalog) return []
    return buildRows(activeConnectionId, catalog, toggleNode, insertSnippet, collectionSort)
  }, [activeConnectionId, connected, catalog, toggleNode, insertSnippet, collectionSort])

  return (
    <div className="catalog">
      <div className="catalog-header">
        <span>{connected ? connName || 'CATALOG' : 'CATALOG'}</span>
        {connected && (
          <button
            className={`catalog-sort${collectionSort === 'alpha' ? ' active' : ''}`}
            title={
              collectionSort === 'alpha'
                ? 'Sorted A–Z — click for natural (server) order'
                : 'Natural (server) order — click to sort A–Z'
            }
            onClick={() =>
              void updateSettings({ collectionSort: collectionSort === 'alpha' ? 'natural' : 'alpha' })
            }
          >
            A–Z
          </button>
        )}
      </div>
      <div className="catalog-body">
        {!connected && <div className="center-msg">Connect to browse</div>}
        {connected && rows.length === 0 && <div className="center-msg muted">Loading…</div>}
        {rows.map((row) => {
          const coll = row.collection
          return (
            <div
              key={row.id}
              className="tree-node"
              style={{ paddingLeft: 8 + row.depth * 14 }}
              onClick={row.onClick}
              title={row.label}
            >
              <span
                className="tree-twisty"
                onClick={(e) => {
                  if (row.expandable && row.onToggle) {
                    e.stopPropagation()
                    row.onToggle()
                  }
                }}
              >
                {row.expandable ? (row.expanded ? '▾' : '▸') : ''}
              </span>
              <span className="tree-icon">{row.icon}</span>
              <span className="tree-label">{row.label}</span>
              {typeof row.count === 'number' && <span className="tree-count">{row.count}</span>}
              {row.loading && <span className="tree-spinner">…</span>}
              {coll && (
                <span className="tree-row-actions">
                  <button
                    className="row-act"
                    title="Export collection"
                    onClick={(e) => {
                      e.stopPropagation()
                      setIoModal({ mode: 'export', db: coll.db, collection: coll.name })
                    }}
                  >
                    ⤓
                  </button>
                  <button
                    className="row-act"
                    title="Import into collection"
                    onClick={(e) => {
                      e.stopPropagation()
                      setIoModal({ mode: 'import', db: coll.db, collection: coll.name })
                    }}
                  >
                    ⤒
                  </button>
                </span>
              )}
            </div>
          )
        })}
      </div>

      {ioModal && activeConnectionId && ioModal.mode === 'export' && (
        <ExportModal
          connectionId={activeConnectionId}
          database={ioModal.db}
          collection={ioModal.collection}
          onClose={() => setIoModal(null)}
        />
      )}
      {ioModal && activeConnectionId && ioModal.mode === 'import' && (
        <ImportModal
          connectionId={activeConnectionId}
          database={ioModal.db}
          collection={ioModal.collection}
          onClose={() => setIoModal(null)}
        />
      )}
    </div>
  )
}

/** Flatten the expanded catalog into ordered visible rows. */
function buildRows(
  connId: string,
  cat: CatalogState,
  toggleNode: (connId: string, nodeId: string, kind: NodeKind, payload: NodePayload) => Promise<void>,
  insertSnippet: (db: string, coll: string) => void,
  sort: CollectionSort
): Row[] {
  const byName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name)
  const rows: Row[] = []
  const dbsRaw = cat.databases ?? []
  const dbs = sort === 'alpha' ? [...dbsRaw].sort(byName) : dbsRaw

  for (const db of dbs) {
    const dbNodeId = `${connId}:db:${db.name}`
    const dbExpanded = cat.expanded.has(dbNodeId)
    rows.push({
      id: dbNodeId,
      depth: 0,
      label: db.name,
      icon: '🗄',
      kind: 'database',
      expandable: true,
      expanded: dbExpanded,
      loading: cat.loading.has(dbNodeId),
      onToggle: () => void toggleNode(connId, dbNodeId, 'database', { db: db.name }),
      onClick: () => void toggleNode(connId, dbNodeId, 'database', { db: db.name })
    })

    if (!dbExpanded) continue

    // Users folder lives at the database level (users are a db concept).
    const usersNodeId = `${connId}:users:${db.name}`
    const usersExpanded = cat.expanded.has(usersNodeId)
    const usersList = cat.users[db.name]
    rows.push({
      id: usersNodeId,
      depth: 1,
      label: 'Users',
      icon: '👤',
      kind: 'users',
      expandable: true,
      expanded: usersExpanded,
      loading: cat.loading.has(usersNodeId),
      count: usersList?.length,
      onToggle: () => void toggleNode(connId, usersNodeId, 'users', { db: db.name }),
      onClick: () => void toggleNode(connId, usersNodeId, 'users', { db: db.name })
    })
    if (usersExpanded && usersList) {
      for (const u of usersList) {
        rows.push({
          id: `${usersNodeId}:${u.db}.${u.user}`,
          depth: 2,
          label: `${u.user} (${u.roles.map((r) => r.role).join(', ') || 'no roles'})`,
          icon: '·',
          kind: 'leaf',
          expandable: false,
          expanded: false,
          loading: false
        })
      }
      if (usersList.length === 0) {
        rows.push(leafNote(`${usersNodeId}:empty`, 2, 'no users'))
      }
    }

    const collsRaw = cat.collections[db.name]
    if (collsRaw === undefined) continue
    const colls = sort === 'alpha' ? [...collsRaw].sort(byName) : collsRaw

    for (const coll of colls) {
      const collNodeId = `${connId}:coll:${db.name}/${coll.name}`
      const collExpanded = cat.expanded.has(collNodeId)
      rows.push({
        id: collNodeId,
        depth: 1,
        label: coll.name,
        icon: coll.type === 'view' ? '👁' : coll.type === 'timeseries' ? '⏱' : '▦',
        kind: 'collection',
        expandable: true,
        expanded: collExpanded,
        loading: false,
        count: coll.estimatedCount,
        collection: { db: db.name, name: coll.name },
        // Toggle expands sub-folders; clicking the row seeds the editor.
        onToggle: () =>
          void toggleNode(connId, collNodeId, 'collection', { db: db.name, coll: coll.name }),
        onClick: () => insertSnippet(db.name, coll.name)
      })

      if (!collExpanded) continue

      // Indexes folder
      const idxNodeId = `${connId}:idx:${db.name}/${coll.name}`
      const idxExpanded = cat.expanded.has(idxNodeId)
      const idxKey = `${db.name}/${coll.name}`
      const idxList = cat.indexes[idxKey]
      rows.push({
        id: idxNodeId,
        depth: 2,
        label: 'Indexes',
        icon: '🔑',
        kind: 'indexes',
        expandable: true,
        expanded: idxExpanded,
        loading: cat.loading.has(idxNodeId),
        count: idxList?.length,
        onToggle: () =>
          void toggleNode(connId, idxNodeId, 'indexes', { db: db.name, coll: coll.name }),
        onClick: () =>
          void toggleNode(connId, idxNodeId, 'indexes', { db: db.name, coll: coll.name })
      })
      if (idxExpanded && idxList) {
        for (const ix of idxList) {
          const keySpec = Object.entries(ix.key)
            .map(([k, v]) => `${k}: ${formatScalar(v).text}`)
            .join(', ')
          rows.push({
            id: `${idxNodeId}:${ix.name}`,
            depth: 3,
            label: `${ix.name} { ${keySpec} }${ix.unique ? ' · unique' : ''}`,
            icon: '·',
            kind: 'leaf',
            expandable: false,
            expanded: false,
            loading: false
          })
        }
        if (idxList.length === 0) {
          rows.push(leafNote(`${idxNodeId}:empty`, 3, 'no indexes'))
        }
      }
    }

    if (colls.length === 0) {
      rows.push(leafNote(`${dbNodeId}:empty`, 1, 'no collections'))
    }
  }

  return rows
}

function leafNote(id: string, depth: number, label: string): Row {
  return {
    id,
    depth,
    label,
    icon: '',
    kind: 'leaf',
    expandable: false,
    expanded: false,
    loading: false
  }
}
