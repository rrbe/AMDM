import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '@renderer/i18n'
import {
  CheckCircle2,
  ChevronRight,
  Clock,
  Database,
  Download,
  Eye,
  Key,
  KeyRound,
  Loader2,
  Monitor,
  Moon,
  MoreVertical,
  Pencil,
  Plug,
  Plus,
  Settings,
  Sun,
  Table2,
  Trash2,
  Unplug,
  Upload,
  User as UserIcon,
  Users as UsersIcon,
  XCircle
} from 'lucide-react'
import type { CollectionSort, ConnectionConfig, ConnectionState } from '@shared/types'
import {
  useAppStore,
  type CatalogState,
  type NodeKind,
  type NodePayload
} from '@renderer/store/useAppStore'
import { formatScalar } from '@renderer/lib/ejson'
import { ConnectionForm } from '@renderer/components/sidebar/ConnectionForm'
import { ContextMenu, type ContextMenuItem } from '@renderer/components/ContextMenu'
import { ExportModal } from '@renderer/components/io/ExportModal'
import { ImportModal } from '@renderer/components/io/ImportModal'
import { SavedQueriesPanel } from '@renderer/components/explorer/SavedQueriesPanel'
import { SettingsModal } from '@renderer/components/settings/SettingsModal'

/** Maps a catalog row's semantic icon key to a lucide glyph. */
function TreeIcon({ name }: { name: string }): JSX.Element | null {
  switch (name) {
    case 'database':
      return <Database size={15} />
    case 'users':
      return <UsersIcon size={15} />
    case 'user':
      return <UserIcon size={14} />
    case 'collection':
      return <Table2 size={15} />
    case 'view':
      return <Eye size={15} />
    case 'timeseries':
      return <Clock size={15} />
    case 'indexes':
      return <KeyRound size={15} />
    case 'index':
      return <Key size={13} />
    default:
      return null
  }
}

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
  /** Database has no data (sharded-empty or authorized-but-uncreated) — drawn
      dashed/muted, mirroring Compass. */
  empty?: boolean
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
  browseCollection: (db: string, coll: string) => void
}

/** Which import/export modal (if any) is open, and for which collection. */
type IoModal = { mode: 'export' | 'import'; connId: string; db: string; collection: string } | null

export function Explorer(): JSX.Element {
  const { t } = useTranslation()
  const connections = useAppStore((s) => s.connections)
  const statuses = useAppStore((s) => s.statuses)
  const catalogs = useAppStore((s) => s.catalogs)
  const expandedConnections = useAppStore((s) => s.expandedConnections)
  const activeConnectionId = useAppStore((s) => s.activeConnectionId)
  const collectionSort = useAppStore((s) => s.settings.collectionSort)
  const theme = useAppStore((s) => s.settings.theme)

  const connect = useAppStore((s) => s.connect)
  const disconnect = useAppStore((s) => s.disconnect)
  const setActiveConnection = useAppStore((s) => s.setActiveConnection)
  const toggleConnectionExpanded = useAppStore((s) => s.toggleConnectionExpanded)
  const setActiveDatabase = useAppStore((s) => s.setActiveDatabase)
  const deleteConnection = useAppStore((s) => s.deleteConnection)
  const exportConnections = useAppStore((s) => s.exportConnections)
  const importConnections = useAppStore((s) => s.importConnections)
  const toggleNode = useAppStore((s) => s.toggleNode)
  const browseCollection = useAppStore((s) => s.browseCollection)
  const updateSettings = useAppStore((s) => s.updateSettings)

  // Saved Queries lives in a bottom drawer, collapsed by default.
  const [savedOpen, setSavedOpen] = useState(false)
  const [connForm, setConnForm] = useState<{ open: boolean; editing?: ConnectionConfig }>({
    open: false
  })
  const [ioModal, setIoModal] = useState<IoModal>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(
    null
  )

  // ⌘, / Ctrl+, opens Settings — the platform convention for preferences.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key === ',') {
        e.preventDefault()
        setSettingsOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Right-click a collection → Export / Import live here (not as hover buttons).
  const openCollMenu = (
    e: MouseEvent,
    coll: { db: string; name: string },
    connId: string
  ): void => {
    e.preventDefault()
    setCtxMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: t('explorer.exportCollection'),
          icon: <Download size={14} />,
          onClick: () =>
            setIoModal({ mode: 'export', connId, db: coll.db, collection: coll.name })
        },
        {
          label: t('explorer.importCollection'),
          icon: <Upload size={14} />,
          onClick: () =>
            setIoModal({ mode: 'import', connId, db: coll.db, collection: coll.name })
        }
      ]
    })
  }

  // Build the flat visible-row list. Connections sit at depth 0; each connected
  // + expanded connection contributes its database subtree starting at depth 1.
  // zustand action refs are stable, so listing them as deps is free.
  const rows = useMemo<Row[]>(() => {
    const actions: RowActions = { toggleNode, setActiveConnection, setActiveDatabase, browseCollection }
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
    browseCollection
  ])

  return (
    <div className="explorer">
      {/* The app brand + window drag strip now live in the global title bar
          (App.tsx); the explorer opens straight into the Connections section. */}
      <div className="side-section side-section--conns">
        <div className="side-section-head">
          <span className="side-section-title">{t('explorer.connections')}</span>
          <button
            className="ghost side-section-more"
            data-tip={t('explorer.backupRestore')}
            aria-label={t('explorer.backupRestore')}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              setCtxMenu({
                x: r.left,
                y: r.bottom + 4,
                items: [
                  {
                    label: t('explorer.exportConnections'),
                    icon: <Download size={14} />,
                    onClick: () => void exportConnections()
                  },
                  {
                    label: t('explorer.importConnections'),
                    icon: <Upload size={14} />,
                    onClick: () => void importConnections()
                  }
                ]
              })
            }}
          >
            <MoreVertical size={15} />
          </button>
          <button
            className="primary btn-new-conn"
            data-tip={t('explorer.newConnectionTip')}
            onClick={() => setConnForm({ open: true })}
          >
            <Plus size={15} />
            <span>{t('explorer.new')}</span>
          </button>
        </div>
        <div className="explorer-body">
          {connections.length === 0 && (
            <div className="explorer-empty">{t('explorer.noConnections')}</div>
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
                  if (confirm(t('explorer.deleteConfirm', { name: row.conn.name }))) void deleteConnection(row.id)
                }}
              />
            ) : (
              <CatalogRow key={row.id} row={row} onContextMenu={openCollMenu} />
            )
          )}
        </div>
      </div>

      {/* Saved Queries: a collapsible drawer pinned to the bottom (collapsed by
          default). The light rule above it separates it from Connections. */}
      <div className="side-section side-section--saved">
        <SavedQueriesPanel open={savedOpen} onToggle={() => setSavedOpen((v) => !v)} />
      </div>

      {/* App-level controls live in the sidebar footer (VS Code pattern), out of
          the way of the query actions. The theme is a persisted preference. */}
      <div className="side-foot">
        <button
          className="theme-cycle"
          data-tip={
            theme === 'system'
              ? t('explorer.theme.system')
              : theme === 'light'
                ? t('explorer.theme.light')
                : t('explorer.theme.dark')
          }
          aria-label={t('explorer.toggleTheme')}
          onClick={() =>
            void updateSettings({
              theme: theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system'
            })
          }
        >
          {theme === 'system' ? (
            <Monitor size={16} />
          ) : theme === 'light' ? (
            <Sun size={16} />
          ) : (
            <Moon size={16} />
          )}
        </button>
        <span className="spacer" />
        <button
          className="theme-cycle"
          data-tip={t('common.settings')}
          aria-label={t('common.settings')}
          onClick={() => setSettingsOpen(true)}
        >
          <Settings size={16} />
        </button>
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
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxMenu.items}
          onClose={() => setCtxMenu(null)}
        />
      )}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
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
  const { t } = useTranslation()
  const { conn, state, expandable, expanded } = row
  const isConnected = state === 'connected'
  const sub = conn.useSrv ? `srv · ${conn.host}` : `${conn.host}:${conn.port ?? 27017}`

  return (
    <div
      className={isActive ? 'conn-item active' : 'conn-item'}
      data-tip={sub}
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
        {expandable ? (
          <ChevronRight size={14} className={expanded ? 'twisty-icon open' : 'twisty-icon'} />
        ) : null}
      </span>
      <span className="conn-status">
        {state === 'connected' ? (
          <CheckCircle2 size={15} className="ok" />
        ) : state === 'error' ? (
          <XCircle size={15} className="err" />
        ) : state === 'connecting' ? (
          <Loader2 size={15} className="spin" />
        ) : (
          <span className="conn-dot-off" />
        )}
      </span>
      <div className="conn-text">
        <div className="conn-name">{conn.name}</div>
        <div className="conn-sub">{sub}</div>
      </div>
      <div className="conn-row-actions">
        {isConnected ? (
          <button
            className="ghost"
            data-tip={t('explorer.disconnect')}
            aria-label={t('explorer.disconnect')}
            onClick={(e) => {
              e.stopPropagation()
              onDisconnect()
            }}
          >
            <Unplug size={14} />
          </button>
        ) : (
          <button
            className="ghost"
            data-tip={t('explorer.connect')}
            aria-label={t('explorer.connect')}
            onClick={(e) => {
              e.stopPropagation()
              onConnect()
            }}
          >
            <Plug size={14} />
          </button>
        )}
        <button
          className="ghost"
          data-tip={t('explorer.edit')}
          aria-label={t('explorer.edit')}
          onClick={(e) => {
            e.stopPropagation()
            onEdit()
          }}
        >
          <Pencil size={14} />
        </button>
        <button
          className="ghost danger"
          data-tip={t('explorer.delete')}
          aria-label={t('explorer.delete')}
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )
}

function CatalogRow({
  row,
  onContextMenu
}: {
  row: TreeRow
  onContextMenu: (e: MouseEvent, coll: { db: string; name: string }, connId: string) => void
}): JSX.Element {
  const { t } = useTranslation()
  const coll = row.collection
  const isNote = row.kind === 'leaf'
  const className =
    'tree-node' +
    (row.empty ? ' tree-node--empty' : '') +
    (isNote ? ' tree-node--note' : '')
  return (
    <div
      className={className}
      style={{ paddingLeft: 8 + row.depth * 14 }}
      onClick={row.onClick}
      onContextMenu={coll ? (e) => onContextMenu(e, coll, row.connId) : undefined}
      data-tip={isNote ? undefined : row.empty ? t('explorer.emptyDb', { name: row.label }) : row.label}
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
        {row.expandable ? (
          <ChevronRight size={14} className={row.expanded ? 'twisty-icon open' : 'twisty-icon'} />
        ) : null}
      </span>
      {row.icon !== '' && (
        <span className="tree-icon">
          <TreeIcon name={row.icon} />
        </span>
      )}
      <span className="tree-label">{row.label}</span>
      {typeof row.count === 'number' && <span className="tree-count">{row.count}</span>}
      {row.loading && (
        <span className="tree-spinner">
          <Loader2 size={12} className="spin" />
        </span>
      )}
    </div>
  )
}

/** Browse a collection (seed its tab), making its connection active first. */
function browseCollection(a: RowActions, connId: string, db: string, coll: string): void {
  a.setActiveConnection(connId)
  a.browseCollection(db, coll)
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
      icon: 'database',
      kind: 'database',
      empty: db.empty === true,
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
      label: i18n.t('explorer.users'),
      icon: 'users',
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
          label: `${u.user} (${u.roles.map((r) => r.role).join(', ') || i18n.t('explorer.noRoles')})`,
          icon: 'user',
          kind: 'leaf',
          expandable: false,
          expanded: false,
          loading: false
        })
      }
      if (usersList.length === 0) {
        rows.push(leafNote(`${usersNodeId}:empty`, connId, 3, i18n.t('explorer.noUsers')))
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
        icon:
          coll.type === 'view' ? 'view' : coll.type === 'timeseries' ? 'timeseries' : 'collection',
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
        label: i18n.t('explorer.indexes'),
        icon: 'indexes',
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
            label: `${ix.name} { ${keySpec} }${ix.unique ? i18n.t('explorer.indexUnique') : ''}`,
            icon: 'index',
            kind: 'leaf',
            expandable: false,
            expanded: false,
            loading: false
          })
        }
        if (idxList.length === 0) {
          rows.push(leafNote(`${idxNodeId}:empty`, connId, 4, i18n.t('explorer.noIndexes')))
        }
      }
    }

    if (colls.length === 0) {
      rows.push(leafNote(`${dbNodeId}:empty`, connId, 2, i18n.t('explorer.noCollections')))
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
