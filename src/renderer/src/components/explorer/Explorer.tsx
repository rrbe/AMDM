import { useMemo, useState } from 'react'
import type { CollectionSort, ConnectionConfig, ConnectionState } from '@shared/types'
import {
  useAppStore,
  type CatalogState,
  type NodeKind,
  type NodePayload
} from '@renderer/store/useAppStore'
import { formatScalar } from '@renderer/lib/ejson'
import { ConnectionForm } from '@renderer/components/sidebar/ConnectionForm'
import { ExportModal } from '@renderer/components/io/ExportModal'
import { ImportModal } from '@renderer/components/io/ImportModal'

/**
 * Unified left panel: a single tree that merges connections and their catalogs.
 *
 *   Connection → Databases → (Users) + Collections → (Indexes) → leaves
 *
 * Top-level rows are connections (state dot, color, host/port + connect / edit /
 * delete actions). A connected connection expands to reveal its database
 * subtree, lazily loaded via catalog.* and cached per-connection in the store.
 *
 * ADR-0004 rule 5: clicking a collection never auto-runs a query; it sets the
 * active connection + database and seeds the editor with `db.<coll>.find({})`.
 */

interface TreeRow {
  type: 'tree'
  id: string
  /** Owning connection — present on every catalog row so actions target it. */
  connId: string
  depth: number
  label: string
  icon: string
  kind: NodeKind | 'leaf'
  expandable: boolean
  expanded: boolean
  loading: boolean
  count?: number
  /** Present on collection rows: enables the Export/Import hover actions. */
  collection?: { db: string; name: string }
  onClick?: () => void
  onToggle?: () => void
}

interface ConnRow {
  type: 'connection'
  id: string
  conn: ConnectionConfig
  state: ConnectionState
  expandable: boolean
  expanded: boolean
  loading: boolean
}

type Row = ConnRow | TreeRow

/** The store actions the catalog rows wire their click handlers to. */
interface RowActions {
  toggleNode: (connId: string, nodeId: string, kind: NodeKind, payload: NodePayload) => Promise<void>
  setActiveConnection: (id: string | null) => void
  setActiveDatabase: (db: string) => void
  insertSnippet: (db: string, coll: string) => void
}

/** Which import/export modal (if any) is open, and for which collection. */
type IoModal = { mode: 'export' | 'import'; connId: string; db: string; collection: string } | null

export function Explorer(): JSX.Element {
  const connections = useAppStore((s) => s.connections)
  const statuses = useAppStore((s) => s.statuses)
  const catalogs = useAppStore((s) => s.catalogs)
  const expandedConnections = useAppStore((s) => s.expandedConnections)
  const activeConnectionId = useAppStore((s) => s.activeConnectionId)
  const collectionSort = useAppStore((s) => s.settings.collectionSort)

  const connect = useAppStore((s) => s.connect)
  const disconnect = useAppStore((s) => s.disconnect)
  const setActiveConnection = useAppStore((s) => s.setActiveConnection)
  const toggleConnectionExpanded = useAppStore((s) => s.toggleConnectionExpanded)
  const setActiveDatabase = useAppStore((s) => s.setActiveDatabase)
  const deleteConnection = useAppStore((s) => s.deleteConnection)
  const toggleNode = useAppStore((s) => s.toggleNode)
  const insertSnippet = useAppStore((s) => s.insertSnippet)
  const updateSettings = useAppStore((s) => s.updateSettings)

  const [connForm, setConnForm] = useState<{ open: boolean; editing?: ConnectionConfig }>({
    open: false
  })
  const [ioModal, setIoModal] = useState<IoModal>(null)

  // Build the flat visible-row list. Connections sit at depth 0; each connected
  // + expanded connection contributes its database subtree starting at depth 1.
  // zustand action refs are stable, so listing them as deps is free.
  const rows = useMemo<Row[]>(() => {
    const actions: RowActions = { toggleNode, setActiveConnection, setActiveDatabase, insertSnippet }
    const out: Row[] = []
    for (const conn of connections) {
      const state = statuses[conn.id]?.state ?? 'disconnected'
      const connected = state === 'connected'
      const expanded = connected && expandedConnections.has(conn.id)
      const catalog = catalogs[conn.id]
      const dbsLoading = catalog?.loading.has(`${conn.id}:databases`) ?? false
      out.push({
        type: 'connection',
        id: conn.id,
        conn,
        state,
        expandable: connected,
        expanded,
        loading: connected && (dbsLoading || catalog?.databases === undefined)
      })
      if (expanded && catalog) {
        out.push(...flattenCatalog(conn.id, catalog, actions, collectionSort))
      }
    }
    return out
  }, [
    connections,
    statuses,
    catalogs,
    expandedConnections,
    collectionSort,
    toggleNode,
    setActiveConnection,
    setActiveDatabase,
    insertSnippet
  ])

  return (
    <div className="explorer">
      <div className="explorer-header app-drag">
        <span className="explorer-title">CONNECTIONS</span>
        <div className="explorer-actions">
          <button
            className={`catalog-sort${collectionSort === 'alpha' ? ' active' : ''}`}
            title={
              collectionSort === 'alpha'
                ? 'Sorted A–Z — click for natural (server) order'
                : 'Natural (server) order — click to sort A–Z'
            }
            onClick={() =>
              void updateSettings({
                collectionSort: collectionSort === 'alpha' ? 'natural' : 'alpha'
              })
            }
          >
            A–Z
          </button>
          <button className="ghost" title="New connection" onClick={() => setConnForm({ open: true })}>
            +
          </button>
        </div>
      </div>

      <div className="explorer-body">
        {connections.length === 0 && (
          <div className="explorer-empty">No connections. Click + to add one.</div>
        )}

        {rows.map((row) =>
          row.type === 'connection' ? (
            <ConnectionRow
              key={row.id}
              row={row}
              isActive={activeConnectionId === row.id}
              onSelect={() => setActiveConnection(row.id)}
              onToggle={() => toggleConnectionExpanded(row.id)}
              onConnect={() => void connect(row.id)}
              onDisconnect={() => void disconnect(row.id)}
              onEdit={() => setConnForm({ open: true, editing: row.conn })}
              onDelete={() => {
                if (confirm(`Delete connection "${row.conn.name}"?`)) void deleteConnection(row.id)
              }}
            />
          ) : (
            <CatalogRow key={row.id} row={row} onOpenIo={setIoModal} />
          )
        )}
      </div>

      {connForm.open && (
        <ConnectionForm editing={connForm.editing} onClose={() => setConnForm({ open: false })} />
      )}

      {ioModal && ioModal.mode === 'export' && (
        <ExportModal
          connectionId={ioModal.connId}
          database={ioModal.db}
          collection={ioModal.collection}
          onClose={() => setIoModal(null)}
        />
      )}
      {ioModal && ioModal.mode === 'import' && (
        <ImportModal
          connectionId={ioModal.connId}
          database={ioModal.db}
          collection={ioModal.collection}
          onClose={() => setIoModal(null)}
        />
      )}
    </div>
  )
}

function ConnectionRow({
  row,
  isActive,
  onSelect,
  onToggle,
  onConnect,
  onDisconnect,
  onEdit,
  onDelete
}: {
  row: ConnRow
  isActive: boolean
  onSelect: () => void
  onToggle: () => void
  onConnect: () => void
  onDisconnect: () => void
  onEdit: () => void
  onDelete: () => void
}): JSX.Element {
  const { conn, state, expandable, expanded } = row
  const isConnected = state === 'connected'
  const sub = conn.useSrv ? `srv · ${conn.host}` : `${conn.host}:${conn.port ?? 27017}`

  return (
    <div
      className={isActive ? 'conn-item active' : 'conn-item'}
      title={sub}
      onClick={onSelect}
      onDoubleClick={() => (isConnected ? onToggle() : onConnect())}
      style={conn.color ? { borderLeft: `3px solid ${conn.color}` } : undefined}
    >
      <span
        className="tree-twisty"
        onClick={(e) => {
          if (expandable) {
            e.stopPropagation()
            onToggle()
          }
        }}
      >
        {expandable ? (expanded ? '▾' : '▸') : ''}
      </span>
      <span className={`state-dot ${state}`} />
      {conn.color && <span className="color-dot" style={{ background: conn.color }} />}
      <div className="conn-text">
        <div className="conn-name">{conn.name}</div>
        <div className="conn-sub">{sub}</div>
      </div>
      <div className="conn-row-actions">
        {isConnected ? (
          <button
            className="ghost"
            title="Disconnect"
            onClick={(e) => {
              e.stopPropagation()
              onDisconnect()
            }}
          >
            ⏏
          </button>
        ) : (
          <button
            className="ghost"
            title="Connect"
            onClick={(e) => {
              e.stopPropagation()
              onConnect()
            }}
          >
            ▶
          </button>
        )}
        <button
          className="ghost"
          title="Edit"
          onClick={(e) => {
            e.stopPropagation()
            onEdit()
          }}
        >
          ✎
        </button>
        <button
          className="ghost danger"
          title="Delete"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
        >
          ✕
        </button>
      </div>
    </div>
  )
}

function CatalogRow({
  row,
  onOpenIo
}: {
  row: TreeRow
  onOpenIo: (m: IoModal) => void
}): JSX.Element {
  const coll = row.collection
  return (
    <div
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
              onOpenIo({ mode: 'export', connId: row.connId, db: coll.db, collection: coll.name })
            }}
          >
            ⤓
          </button>
          <button
            className="row-act"
            title="Import into collection"
            onClick={(e) => {
              e.stopPropagation()
              onOpenIo({ mode: 'import', connId: row.connId, db: coll.db, collection: coll.name })
            }}
          >
            ⤒
          </button>
        </span>
      )}
    </div>
  )
}

/** Seed the editor for a collection, making its connection active first. */
function browseCollection(a: RowActions, connId: string, db: string, coll: string): void {
  a.setActiveConnection(connId)
  a.insertSnippet(db, coll)
}

/** Toggle a database node and sync the work area's active connection + db. */
function openDatabase(a: RowActions, connId: string, db: string, nodeId: string): void {
  a.setActiveConnection(connId)
  a.setActiveDatabase(db)
  void a.toggleNode(connId, nodeId, 'database', { db })
}

/**
 * Flatten one connection's expanded catalog into ordered rows (depth ≥ 1).
 * Mirrors the old CatalogTree builder, offset one level under the connection.
 */
function flattenCatalog(
  connId: string,
  cat: CatalogState,
  a: RowActions,
  sort: CollectionSort
): TreeRow[] {
  const byName = (x: { name: string }, y: { name: string }): number => x.name.localeCompare(y.name)
  const rows: TreeRow[] = []
  const dbsRaw = cat.databases ?? []
  const dbs = sort === 'alpha' ? [...dbsRaw].sort(byName) : dbsRaw

  for (const db of dbs) {
    const dbNodeId = `${connId}:db:${db.name}`
    const dbExpanded = cat.expanded.has(dbNodeId)
    rows.push({
      type: 'tree',
      id: dbNodeId,
      connId,
      depth: 1,
      label: db.name,
      icon: '🗄',
      kind: 'database',
      expandable: true,
      expanded: dbExpanded,
      loading: cat.loading.has(dbNodeId),
      onToggle: () => openDatabase(a, connId, db.name, dbNodeId),
      onClick: () => openDatabase(a, connId, db.name, dbNodeId)
    })

    if (!dbExpanded) continue

    // Users folder lives at the database level (users are a db concept).
    const usersNodeId = `${connId}:users:${db.name}`
    const usersExpanded = cat.expanded.has(usersNodeId)
    const usersList = cat.users[db.name]
    rows.push({
      type: 'tree',
      id: usersNodeId,
      connId,
      depth: 2,
      label: 'Users',
      icon: '👤',
      kind: 'users',
      expandable: true,
      expanded: usersExpanded,
      loading: cat.loading.has(usersNodeId),
      count: usersList?.length,
      onToggle: () => void a.toggleNode(connId, usersNodeId, 'users', { db: db.name }),
      onClick: () => void a.toggleNode(connId, usersNodeId, 'users', { db: db.name })
    })
    if (usersExpanded && usersList) {
      for (const u of usersList) {
        rows.push({
          type: 'tree',
          id: `${usersNodeId}:${u.db}.${u.user}`,
          connId,
          depth: 3,
          label: `${u.user} (${u.roles.map((r) => r.role).join(', ') || 'no roles'})`,
          icon: '·',
          kind: 'leaf',
          expandable: false,
          expanded: false,
          loading: false
        })
      }
      if (usersList.length === 0) {
        rows.push(leafNote(`${usersNodeId}:empty`, connId, 3, 'no users'))
      }
    }

    const collsRaw = cat.collections[db.name]
    if (collsRaw === undefined) continue
    const colls = sort === 'alpha' ? [...collsRaw].sort(byName) : collsRaw

    for (const coll of colls) {
      const collNodeId = `${connId}:coll:${db.name}/${coll.name}`
      const collExpanded = cat.expanded.has(collNodeId)
      rows.push({
        type: 'tree',
        id: collNodeId,
        connId,
        depth: 2,
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
          void a.toggleNode(connId, collNodeId, 'collection', { db: db.name, coll: coll.name }),
        onClick: () => browseCollection(a, connId, db.name, coll.name)
      })

      if (!collExpanded) continue

      // Indexes folder
      const idxNodeId = `${connId}:idx:${db.name}/${coll.name}`
      const idxExpanded = cat.expanded.has(idxNodeId)
      const idxKey = `${db.name}/${coll.name}`
      const idxList = cat.indexes[idxKey]
      rows.push({
        type: 'tree',
        id: idxNodeId,
        connId,
        depth: 3,
        label: 'Indexes',
        icon: '🔑',
        kind: 'indexes',
        expandable: true,
        expanded: idxExpanded,
        loading: cat.loading.has(idxNodeId),
        count: idxList?.length,
        onToggle: () =>
          void a.toggleNode(connId, idxNodeId, 'indexes', { db: db.name, coll: coll.name }),
        onClick: () =>
          void a.toggleNode(connId, idxNodeId, 'indexes', { db: db.name, coll: coll.name })
      })
      if (idxExpanded && idxList) {
        for (const ix of idxList) {
          const keySpec = Object.entries(ix.key)
            .map(([k, v]) => `${k}: ${formatScalar(v).text}`)
            .join(', ')
          rows.push({
            type: 'tree',
            id: `${idxNodeId}:${ix.name}`,
            connId,
            depth: 4,
            label: `${ix.name} { ${keySpec} }${ix.unique ? ' · unique' : ''}`,
            icon: '·',
            kind: 'leaf',
            expandable: false,
            expanded: false,
            loading: false
          })
        }
        if (idxList.length === 0) {
          rows.push(leafNote(`${idxNodeId}:empty`, connId, 4, 'no indexes'))
        }
      }
    }

    if (colls.length === 0) {
      rows.push(leafNote(`${dbNodeId}:empty`, connId, 2, 'no collections'))
    }
  }

  return rows
}

function leafNote(id: string, connId: string, depth: number, label: string): TreeRow {
  return {
    type: 'tree',
    id,
    connId,
    depth,
    label,
    icon: '',
    kind: 'leaf',
    expandable: false,
    expanded: false,
    loading: false
  }
}
