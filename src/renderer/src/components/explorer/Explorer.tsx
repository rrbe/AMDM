import { useMemo, useState, type DragEvent, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Bookmark,
  ChevronRight,
  Clock,
  Clock3,
  Database,
  Download,
  Eye,
  Key,
  KeyRound,
  Loader2,
  Monitor,
  Moon,
  Pencil,
  PanelLeftClose,
  Plug,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sun,
  Table2,
  Trash2,
  Unplug,
  Upload,
  User as UserIcon,
  Users as UsersIcon,
  X
} from 'lucide-react'
import type { CollectionSort, ConnectionConfig, ConnectionState } from '@shared/types'
import {
  useAppStore,
  getActiveTab,
  type CatalogState,
  type NodeKind,
  type NodePayload
} from '@renderer/store/useAppStore'
import { formatScalar } from '@renderer/lib/ejson'
import { tabCollection } from '@renderer/lib/tabs'
import { formatMongoHosts } from '@renderer/lib/connectionUri'
import { formatBytes } from '@renderer/lib/formatBytes'
import {
  applyConnectionOrder,
  reorderConnectionIds,
  type DropEdge
} from '@renderer/lib/connectionOrder'
import { ConnectionForm } from '@renderer/components/sidebar/ConnectionForm'
import { ContextMenu, type ContextMenuEntry } from '@renderer/components/ContextMenu'
import { ExportModal } from '@renderer/components/io/ExportModal'
import { ImportModal } from '@renderer/components/io/ImportModal'
import {
  HistoryView,
  SavedQueriesView,
  type StoredQuerySelection
} from '@renderer/components/explorer/SavedQueriesPanel'

export type ExplorerView = 'connections' | 'savedQueries' | 'history'

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
 *   Connection → Databases → Collections → (Indexes) → leaves + (Users)
 *
 * Top-level rows are connections — each shows only a live status signal, name,
 * and hosts; management and refresh actions live in right-click menus. A
 * connected connection expands to reveal its database subtree, lazily loaded
 * via catalog.* and cached per-connection in the store.
 *
 * Clicking a collection runs one bounded newest-first query on first open;
 * clicking it again focuses the existing Shell tab without re-running it.
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
  /** Approximate storage size shown beside an exact child count. */
  sizeOnDisk?: number
  approximateCount?: boolean
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
  error?: string
  expandable: boolean
  expanded: boolean
  loading: boolean
}

type Row = ConnRow | TreeRow

/** The store actions the catalog rows wire their click handlers to. */
interface RowActions {
  toggleNode: (
    connId: string,
    nodeId: string,
    kind: NodeKind,
    payload: NodePayload
  ) => Promise<void>
  setActiveConnection: (id: string | null) => void
  setActiveDatabase: (db: string) => void
  browseCollection: (db: string, coll: string) => void
}

/** Which import/export modal (if any) is open, and for which collection. */
type IoModal = {
  mode: 'export' | 'import'
  connId: string
  db: string
  collection: string
} | null

export function Explorer({
  view,
  onViewChange,
  onQueryLoad,
  onCollapse,
  onSettings
}: {
  view: ExplorerView
  onViewChange: (view: ExplorerView) => void
  onQueryLoad: (query: StoredQuerySelection) => void
  onCollapse: () => void
  onSettings: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const connections = useAppStore((s) => s.connections)
  const statuses = useAppStore((s) => s.statuses)
  const catalogs = useAppStore((s) => s.catalogs)
  const expandedConnections = useAppStore((s) => s.expandedConnections)
  const activeConnectionId = useAppStore((s) => s.activeConnectionId)
  const connectionOrder = useAppStore((s) => s.settings.connectionOrder)
  const collectionSort = useAppStore((s) => s.settings.collectionSort)
  const theme = useAppStore((s) => s.settings.theme)
  const activeTab = useAppStore(getActiveTab)

  const connect = useAppStore((s) => s.connect)
  const disconnect = useAppStore((s) => s.disconnect)
  const setActiveConnection = useAppStore((s) => s.setActiveConnection)
  const toggleConnectionExpanded = useAppStore((s) => s.toggleConnectionExpanded)
  const setActiveDatabase = useAppStore((s) => s.setActiveDatabase)
  const deleteConnection = useAppStore((s) => s.deleteConnection)
  const toggleNode = useAppStore((s) => s.toggleNode)
  const loadDatabases = useAppStore((s) => s.loadDatabases)
  const loadCollections = useAppStore((s) => s.loadCollections)
  const browseCollection = useAppStore((s) => s.browseCollection)
  const updateSettings = useAppStore((s) => s.updateSettings)

  const [searchOpen, setSearchOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [connForm, setConnForm] = useState<{
    open: boolean
    editing?: ConnectionConfig
  }>({
    open: false
  })
  const [ioModal, setIoModal] = useState<IoModal>(null)
  const [ctxMenu, setCtxMenu] = useState<{
    x: number
    y: number
    items: ContextMenuEntry[]
  } | null>(null)
  const orderedConnections = useMemo(
    () => applyConnectionOrder(connections, connectionOrder),
    [connections, connectionOrder]
  )

  // Right-click a connection → manage it or refresh only its database list.
  const openConnMenu = (e: MouseEvent, row: ConnRow): void => {
    e.preventDefault()
    const disconnectable = row.state === 'connected' || row.state === 'connecting'
    setCtxMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        disconnectable
          ? {
              label: 'Disconnect',
              icon: <Unplug size={14} />,
              onClick: () => void disconnect(row.id)
            }
          : {
              label: 'Connect',
              icon: <Plug size={14} />,
              onClick: () => void connect(row.id)
            },
        {
          label: 'Refresh',
          icon: <RefreshCw size={14} />,
          disabled: row.state !== 'connected',
          onClick: () => void loadDatabases(row.id)
        },
        'separator',
        {
          label: 'Edit',
          icon: <Pencil size={14} />,
          onClick: () => setConnForm({ open: true, editing: row.conn })
        },
        {
          label: 'Delete',
          icon: <Trash2 size={14} />,
          danger: true,
          onClick: () => {
            if (confirm(`Delete connection "${row.conn.name}"?`)) void deleteConnection(row.id)
          }
        }
      ]
    })
  }

  // Right-click a database refreshes only its Collections; collection actions
  // remain scoped to that collection.
  const openCatalogMenu = (e: MouseEvent, row: TreeRow): void => {
    e.preventDefault()
    if (row.kind === 'database') {
      setCtxMenu({
        x: e.clientX,
        y: e.clientY,
        items: [
          {
            label: 'Refresh',
            icon: <RefreshCw size={14} />,
            onClick: () => void loadCollections(row.connId, row.label)
          }
        ]
      })
      return
    }

    const coll = row.collection
    if (!coll) return
    setCtxMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: t('io.exportCollection'),
          icon: <Download size={14} />,
          onClick: () =>
            setIoModal({
              mode: 'export',
              connId: row.connId,
              db: coll.db,
              collection: coll.name
            })
        },
        {
          label: t('io.importCollection'),
          icon: <Upload size={14} />,
          onClick: () =>
            setIoModal({
              mode: 'import',
              connId: row.connId,
              db: coll.db,
              collection: coll.name
            })
        }
      ]
    })
  }

  // Build the flat visible-row list. Connections sit at depth 0; each connected
  // + expanded connection contributes its database subtree starting at depth 1.
  // zustand action refs are stable, so listing them as deps is free.
  const rows = useMemo<Row[]>(() => {
    const actions: RowActions = {
      toggleNode,
      setActiveConnection,
      setActiveDatabase,
      browseCollection
    }
    const out: Row[] = []
    for (const conn of orderedConnections) {
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
        error: statuses[conn.id]?.error,
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
    orderedConnections,
    statuses,
    catalogs,
    expandedConnections,
    collectionSort,
    toggleNode,
    setActiveConnection,
    setActiveDatabase,
    browseCollection
  ])
  const visibleRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    if (!query) return rows
    return rows.filter((row) =>
      row.type === 'connection'
        ? `${row.conn.name} ${row.conn.host}`.toLocaleLowerCase().includes(query)
        : row.label.toLocaleLowerCase().includes(query)
    )
  }, [rows, search])
  const activeCollection = tabCollection(activeTab)
  const moveConnection = (sourceId: string, targetId: string, edge: DropEdge): void => {
    const ids = orderedConnections.map((connection) => connection.id)
    const next = reorderConnectionIds(ids, sourceId, targetId, edge)
    if (next !== ids) void updateSettings({ connectionOrder: next })
  }

  return (
    <div className="explorer">
      <div className="explorer-head app-drag">
        <div className="app-brand">
          <span>AMDM</span>
        </div>
        <button
          className="side-head-action"
          data-tip={t('explorer.collapse')}
          aria-label={t('explorer.collapse')}
          onClick={onCollapse}
        >
          <PanelLeftClose size={16} />
        </button>
      </div>

      <nav className="explorer-nav" aria-label={t('navigation.title')}>
        <button
          className={view === 'connections' ? 'explorer-nav-item is-active' : 'explorer-nav-item'}
          data-tip={view === 'connections' ? undefined : t('navigation.data')}
          aria-label={t('navigation.data')}
          aria-current={view === 'connections' ? 'page' : undefined}
          onClick={() => onViewChange('connections')}
        >
          <Database size={17} />
          {view === 'connections' && <span>{t('navigation.data')}</span>}
        </button>
        <button
          className={view === 'savedQueries' ? 'explorer-nav-item is-active' : 'explorer-nav-item'}
          data-tip={view === 'savedQueries' ? undefined : t('navigation.saved')}
          aria-label={t('navigation.saved')}
          aria-current={view === 'savedQueries' ? 'page' : undefined}
          onClick={() => onViewChange('savedQueries')}
        >
          <Bookmark size={17} />
          {view === 'savedQueries' && <span>{t('navigation.saved')}</span>}
        </button>
        <button
          className={view === 'history' ? 'explorer-nav-item is-active' : 'explorer-nav-item'}
          data-tip={view === 'history' ? undefined : t('navigation.history')}
          aria-label={t('navigation.history')}
          aria-current={view === 'history' ? 'page' : undefined}
          onClick={() => onViewChange('history')}
        >
          <Clock3 size={17} />
          {view === 'history' && <span>{t('navigation.history')}</span>}
        </button>
      </nav>

      {view === 'connections' && searchOpen && (
        <div className="explorer-search">
          <Search size={14} aria-hidden />
          <input
            autoFocus
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('explorer.searchPlaceholder')}
            aria-label={t('explorer.search')}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              aria-label={t('explorer.clearSearch')}
              data-tip={t('explorer.clearSearch')}
            >
              <X size={13} />
            </button>
          )}
        </div>
      )}

      {view === 'connections' ? (
        <>
          <div className="side-section side-section--conns">
            <div className="side-section-head">
              <span className="side-section-title">Connections</span>
              <button
                className={searchOpen ? 'side-head-action is-active' : 'side-head-action'}
                data-tip={t('explorer.search')}
                aria-label={t('explorer.search')}
                aria-pressed={searchOpen}
                onClick={() => {
                  if (searchOpen) setSearch('')
                  setSearchOpen((open) => !open)
                }}
              >
                <Search size={16} />
              </button>
            </div>
            <div className="explorer-body">
              {connections.length === 0 && (
                <div className="explorer-empty">No connections. Click "New" to add one.</div>
              )}

              {search.trim() && visibleRows.length === 0 && (
                <div className="explorer-empty">{t('explorer.noSearchResults')}</div>
              )}

              {visibleRows.map((row) =>
                row.type === 'connection' ? (
                  <ConnectionRow
                    key={row.id}
                    row={row}
                    isActive={activeConnectionId === row.id}
                    onSelect={() => setActiveConnection(row.id)}
                    onToggle={() => toggleConnectionExpanded(row.id)}
                    onConnect={() => void connect(row.id)}
                    onMove={moveConnection}
                    onContextMenu={(e) => openConnMenu(e, row)}
                  />
                ) : (
                  <CatalogRow
                    key={row.id}
                    row={row}
                    isActive={
                      row.connId === activeConnectionId &&
                      (row.collection
                        ? row.collection.db === activeTab.activeDatabase &&
                          row.collection.name === activeCollection
                        : row.kind === 'database' && row.label === activeTab.activeDatabase)
                    }
                    onContextMenu={openCatalogMenu}
                  />
                )
              )}
            </div>
          </div>

          <div className="explorer-create">
            <button className="btn-new-conn" onClick={() => setConnForm({ open: true })}>
              <Plus size={15} />
              <span>{t('explorer.newConnection')}</span>
            </button>
          </div>
        </>
      ) : view === 'savedQueries' ? (
        <SavedQueriesView onLoad={onQueryLoad} />
      ) : (
        <HistoryView onLoad={onQueryLoad} />
      )}

      {/* App-level controls stay in the quiet footer. */}
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
        <span className="side-foot-build" title={__BUILD_ID__}>
          {__BUILD_ID__}
        </span>
        <button
          className="theme-cycle"
          data-tip={t('common.settings')}
          aria-label={t('common.settings')}
          onClick={onSettings}
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
    </div>
  )
}

function ConnectionRow({
  row,
  isActive,
  onSelect,
  onToggle,
  onConnect,
  onMove,
  onContextMenu
}: {
  row: ConnRow
  isActive: boolean
  onSelect: () => void
  onToggle: () => void
  onConnect: () => void
  onMove: (sourceId: string, targetId: string, edge: DropEdge) => void
  onContextMenu: (e: MouseEvent) => void
}): JSX.Element {
  const { t } = useTranslation()
  const [dragging, setDragging] = useState(false)
  const [dropEdge, setDropEdge] = useState<DropEdge | null>(null)
  const { conn, state, error, expandable, expanded } = row
  const isConnected = state === 'connected'
  const sub =
    conn.useSrv ? `srv · ${conn.host}` : formatMongoHosts(conn.host, conn.port ?? 27017)

  // The lone surviving piece of chrome: a single status signal whose color +
  // glow carry the live state. Actions stay in the right-click menu.
  const signalClass = `conn-signal conn-signal--${
    state === 'connected'
      ? 'on'
      : state === 'error'
        ? 'error'
        : state === 'connecting'
          ? 'connecting'
          : 'off'
  }`
  const statusLabel =
    state === 'error' && error
      ? `${t('connection.status.error')}: ${error}`
      : t(`connection.status.${state}`)

  return (
    <div
      className={`conn-item${isActive ? ' active' : ''}${dragging ? ' dragging' : ''}${dropEdge ? ` drop-${dropEdge}` : ''}`}
      draggable
      aria-grabbed={dragging}
      onClick={onSelect}
      onDoubleClick={() => (isConnected ? onToggle() : state !== 'connecting' && onConnect())}
      onDragStart={(e: DragEvent<HTMLDivElement>) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', row.id)
        setDragging(true)
      }}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        const rect = e.currentTarget.getBoundingClientRect()
        setDropEdge(e.clientY < rect.top + rect.height / 2 ? 'before' : 'after')
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropEdge(null)
      }}
      onDrop={(e) => {
        e.preventDefault()
        const sourceId = e.dataTransfer.getData('text/plain')
        if (sourceId && dropEdge) onMove(sourceId, row.id, dropEdge)
        setDropEdge(null)
      }}
      onDragEnd={() => {
        setDragging(false)
        setDropEdge(null)
      }}
      onContextMenu={onContextMenu}
      style={conn.color ? { borderLeftColor: conn.color } : undefined}
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
      <div className="conn-text">
        <div
          className="conn-name"
          style={{ color: conn.color ? `color-mix(in srgb, ${conn.color} 60%, var(--text-secondary))` : undefined }}
        >
          {conn.name}
        </div>
        <div className="conn-sub" data-tip={sub} data-tip-overflow="">
          {sub}
        </div>
      </div>
      <span
        className="conn-status"
        role="status"
        aria-label={statusLabel}
        data-tip={statusLabel}
      >
        <span className={signalClass} />
      </span>
    </div>
  )
}

function CatalogRow({
  row,
  isActive,
  onContextMenu
}: {
  row: TreeRow
  isActive: boolean
  onContextMenu: (e: MouseEvent, row: TreeRow) => void
}): JSX.Element {
  const coll = row.collection
  const isNote = row.kind === 'leaf'
  const className =
    'tree-node' +
    (isActive ? ' active' : '') +
    (row.empty ? ' tree-node--empty' : '') +
    (isNote ? ' tree-node--note' : '')
  return (
    <div
      className={className}
      style={{ paddingLeft: 8 + row.depth * 14 }}
      onClick={row.onClick}
      onContextMenu={row.kind === 'database' || coll ? (e) => onContextMenu(e, row) : undefined}
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
      <span
        className="tree-label"
        data-tip={
          isNote ? undefined : row.empty ? `${row.label} — empty (no collections yet)` : row.label
        }
        data-tip-overflow={isNote || row.empty ? undefined : ''}
      >
        {row.label}
      </span>
      {typeof row.count === 'number' && (
        <span className="tree-count">
          ({row.approximateCount ? '~' : ''}
          {row.count.toLocaleString()}
          {typeof row.sizeOnDisk === 'number' ? ` | ${formatBytes(row.sizeOnDisk)}` : ''})
        </span>
      )}
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
      count: cat.collections[db.name]?.length,
      sizeOnDisk: cat.collections[db.name] === undefined ? undefined : db.sizeOnDisk,
      onToggle: () => openDatabase(a, connId, db.name, dbNodeId),
      onClick: () => openDatabase(a, connId, db.name, dbNodeId)
    })

    if (!dbExpanded) continue

    const collsRaw = cat.collections[db.name]
    const colls =
      collsRaw === undefined ? [] : sort === 'alpha' ? [...collsRaw].sort(byName) : collsRaw

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
        loading: cat.loading.has(collNodeId),
        count: coll.estimatedCount,
        approximateCount: coll.estimatedCount !== undefined,
        collection: { db: db.name, name: coll.name },
        // Toggle expands sub-folders; clicking the row seeds the editor.
        onToggle: () =>
          void a.toggleNode(connId, collNodeId, 'collection', {
            db: db.name,
            coll: coll.name
          }),
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
        icon: 'indexes',
        kind: 'indexes',
        expandable: true,
        expanded: idxExpanded,
        loading: cat.loading.has(idxNodeId),
        count: idxList?.length,
        onToggle: () =>
          void a.toggleNode(connId, idxNodeId, 'indexes', {
            db: db.name,
            coll: coll.name
          }),
        onClick: () =>
          void a.toggleNode(connId, idxNodeId, 'indexes', {
            db: db.name,
            coll: coll.name
          })
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
            icon: 'index',
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

    if (collsRaw !== undefined && colls.length === 0) {
      rows.push(leafNote(`${dbNodeId}:empty`, connId, 2, 'no collections'))
    }

    // Users are a database concept, shown after the database's collections.
    const usersNodeId = `${connId}:users:${db.name}`
    const usersExpanded = cat.expanded.has(usersNodeId)
    const usersList = cat.users[db.name]
    rows.push({
      type: 'tree',
      id: usersNodeId,
      connId,
      depth: 2,
      label: 'Users',
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
          label: `${u.user} (${u.roles.map((r) => r.role).join(', ') || 'no roles'})`,
          icon: 'user',
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
