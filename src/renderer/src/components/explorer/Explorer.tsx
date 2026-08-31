import { useEffect, useMemo, useState, type DragEvent, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Bookmark,
  ChartNoAxesColumnIncreasing,
  ChevronRight,
  Clock,
  Clock3,
  Copy,
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
import type { CollectionSort, ConnectionConfig, ConnectionState, SchemaTarget } from '@shared/types'
import { useAppStore, type CatalogState, type NodeKind, type NodePayload } from '@renderer/store/useAppStore'
import { formatScalar } from '@renderer/lib/ejson'
import { formatMongoHosts } from '@renderer/lib/connectionUri'
import { formatBytes } from '@renderer/lib/formatBytes'
import { copyText } from '@renderer/lib/resultCopy'
import { applyConnectionOrder, reorderConnectionIds, type DropEdge } from '@renderer/lib/connectionOrder'
import { ConnectionForm } from '@renderer/components/sidebar/ConnectionForm'
import { ContextMenu, type ContextMenuEntry } from '@renderer/components/ContextMenu'
import { ExportModal } from '@renderer/components/io/ExportModal'
import { ImportModal } from '@renderer/components/io/ImportModal'
import { SchemaModelModal } from '@renderer/components/schema/SchemaModelModal'
import { Tooltip } from '@renderer/components/ui/Tooltip'
import {
  HistoryView,
  SavedQueriesView,
  type StoredQuerySelection
} from '@renderer/components/explorer/SavedQueriesPanel'

export type ExplorerView = 'connections' | 'savedQueries' | 'history'

/** Maps a catalog row's semantic icon key to a lucide glyph. */
function TreeIcon({ name }: { name: string }): React.JSX.Element | null {
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
 * Double-clicking a collection runs one bounded newest-first query on first open;
 * double-clicking it again focuses the existing Shell tab without re-running it.
 */

interface TreeRow {
  type: 'tree'
  id: string
  /** Owning connection — present on every catalog row so actions target it. */
  connId: string
  depth: number
  label: string
  icon: string
  kind: NodeKind | 'index' | 'leaf'
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
  collection?: { db: string; name: string; type: 'collection' | 'view' | 'timeseries' }
  /** Optional tooltip override; unlike ordinary catalog labels, it is always shown. */
  tooltip?: string
  /** Present on index rows: enables index-specific actions. */
  indexName?: string
  /** Present on the Indexes folder: scopes refresh to its owning collection. */
  indexCollection?: { db: string; name: string }
  onClick?: () => void
  onDoubleClick?: () => void
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

export function canDisconnectConnection(state: ConnectionState): boolean {
  return state !== 'disconnected'
}

/** The store actions the catalog rows wire their click handlers to. */
interface RowActions {
  toggleNode: (connId: string, nodeId: string, kind: NodeKind, payload: NodePayload) => Promise<void>
  setActiveConnection: (id: string | null) => void
  browseCollection: (db: string, coll: string) => void
  inspectIndex: (db: string, coll: string, indexName: string) => void
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
  onSettings,
  newConnectionRequested,
  onNewConnectionRequestHandled
}: {
  view: ExplorerView
  onViewChange: (view: ExplorerView) => void
  onQueryLoad: (query: StoredQuerySelection) => void
  onCollapse: () => void
  onSettings: () => void
  newConnectionRequested: boolean
  onNewConnectionRequestHandled: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const connections = useAppStore((s) => s.connections)
  const statuses = useAppStore((s) => s.statuses)
  const catalogs = useAppStore((s) => s.catalogs)
  const expandedConnections = useAppStore((s) => s.expandedConnections)
  const connectionOrder = useAppStore((s) => s.settings.connectionOrder)
  const collectionSort = useAppStore((s) => s.settings.collectionSort)
  const theme = useAppStore((s) => s.settings.theme)
  const updateState = useAppStore((s) => s.updateState)
  const availableVersion = updateState.availableVersion

  const connect = useAppStore((s) => s.connect)
  const disconnect = useAppStore((s) => s.disconnect)
  const setActiveConnection = useAppStore((s) => s.setActiveConnection)
  const toggleConnectionExpanded = useAppStore((s) => s.toggleConnectionExpanded)
  const deleteConnection = useAppStore((s) => s.deleteConnection)
  const toggleNode = useAppStore((s) => s.toggleNode)
  const loadDatabases = useAppStore((s) => s.loadDatabases)
  const loadCollections = useAppStore((s) => s.loadCollections)
  const loadIndexes = useAppStore((s) => s.loadIndexes)
  const refreshCollection = useAppStore((s) => s.refreshCollection)
  const browseCollection = useAppStore((s) => s.browseCollection)
  const inspectIndex = useAppStore((s) => s.inspectIndex)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const showAvailableUpdate = useAppStore((s) => s.showAvailableUpdate)

  const [searchOpen, setSearchOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null)
  const [connForm, setConnForm] = useState<{
    open: boolean
    editing?: ConnectionConfig
  }>({
    open: false
  })
  const [ioModal, setIoModal] = useState<IoModal>(null)
  const [schemaTarget, setSchemaTarget] = useState<SchemaTarget | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{
    x: number
    y: number
    items: ContextMenuEntry[]
  } | null>(null)

  useEffect(() => {
    if (!newConnectionRequested) return
    setCtxMenu(null)
    setConnForm({ open: true })
    onNewConnectionRequestHandled()
  }, [newConnectionRequested, onNewConnectionRequestHandled])

  const orderedConnections = useMemo(
    () => applyConnectionOrder(connections, connectionOrder),
    [connections, connectionOrder]
  )

  // Right-click a connection → manage it or refresh only its database list.
  const openConnMenu = (e: MouseEvent, row: ConnRow): void => {
    e.preventDefault()
    const disconnectable = canDisconnectConnection(row.state)
    setCtxMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        disconnectable
          ? {
              label: t('connection.menu.disconnect'),
              icon: <Unplug size={14} />,
              onClick: () => void disconnect(row.id)
            }
          : {
              label: t('connection.menu.connect'),
              icon: <Plug size={14} />,
              onClick: () => void connect(row.id)
            },
        {
          label: t('common.refresh'),
          icon: <RefreshCw size={14} />,
          disabled: row.state !== 'connected',
          onClick: () => void loadDatabases(row.id)
        },
        'separator',
        {
          label: t('connection.menu.edit'),
          icon: <Pencil size={14} />,
          onClick: () => setConnForm({ open: true, editing: row.conn })
        },
        {
          label: t('connection.menu.delete'),
          icon: <Trash2 size={14} />,
          danger: true,
          onClick: () => {
            if (confirm(t('connection.menu.deleteConfirm', { name: row.conn.name }))) {
              void deleteConnection(row.id)
            }
          }
        }
      ]
    })
  }

  // Right-click a database refreshes only its Collections; collection actions
  // remain scoped to that collection.
  const openCatalogMenu = (e: MouseEvent, row: TreeRow): void => {
    e.preventDefault()
    const indexName = row.indexName
    if (row.kind === 'index' && indexName !== undefined) {
      setCtxMenu({
        x: e.clientX,
        y: e.clientY,
        items: [
          {
            label: t('explorer.copyIndexName'),
            icon: <Copy size={14} />,
            onClick: () => void copyText(indexName)
          }
        ]
      })
      return
    }

    const indexCollection = row.indexCollection
    if (row.kind === 'indexes' && indexCollection) {
      setCtxMenu({
        x: e.clientX,
        y: e.clientY,
        items: [
          {
            label: t('common.refresh'),
            icon: <RefreshCw size={14} />,
            disabled: row.loading,
            onClick: () => void loadIndexes(row.connId, indexCollection.db, indexCollection.name)
          }
        ]
      })
      return
    }

    if (row.kind === 'database') {
      setCtxMenu({
        x: e.clientX,
        y: e.clientY,
        items: [
          {
            label: t('common.refresh'),
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
          label: t('common.refresh'),
          icon: <RefreshCw size={14} />,
          disabled: coll.type === 'view' || row.loading,
          onClick: () => void refreshCollection(row.connId, coll.db, coll.name)
        },
        'separator',
        {
          label: t('schema.menu'),
          icon: <ChartNoAxesColumnIncreasing size={14} />,
          disabled: coll.type === 'view',
          onClick: () =>
            setSchemaTarget({
              connectionId: row.connId,
              database: coll.db,
              collection: coll.name
            })
        },
        'separator',
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
      browseCollection,
      inspectIndex
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
    browseCollection,
    inspectIndex
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
        <button className="side-head-action" aria-label={t('explorer.collapse')} onClick={onCollapse}>
          <PanelLeftClose size={16} />
        </button>
      </div>

      <nav className="explorer-nav" aria-label={t('navigation.title')}>
        <Tooltip content={view === 'connections' ? undefined : t('navigation.data')}>
          <button
            className={view === 'connections' ? 'explorer-nav-item is-active' : 'explorer-nav-item'}
            aria-label={t('navigation.data')}
            aria-current={view === 'connections' ? 'page' : undefined}
            onClick={() => onViewChange('connections')}
          >
            <Database size={17} />
            {view === 'connections' && <span>{t('navigation.data')}</span>}
          </button>
        </Tooltip>
        <Tooltip content={view === 'savedQueries' ? undefined : t('navigation.saved')}>
          <button
            className={view === 'savedQueries' ? 'explorer-nav-item is-active' : 'explorer-nav-item'}
            aria-label={t('navigation.saved')}
            aria-current={view === 'savedQueries' ? 'page' : undefined}
            onClick={() => onViewChange('savedQueries')}
          >
            <Bookmark size={17} />
            {view === 'savedQueries' && <span>{t('navigation.saved')}</span>}
          </button>
        </Tooltip>
        <Tooltip content={view === 'history' ? undefined : t('navigation.history')}>
          <button
            className={view === 'history' ? 'explorer-nav-item is-active' : 'explorer-nav-item'}
            aria-label={t('navigation.history')}
            aria-current={view === 'history' ? 'page' : undefined}
            onClick={() => onViewChange('history')}
          >
            <Clock3 size={17} />
            {view === 'history' && <span>{t('navigation.history')}</span>}
          </button>
        </Tooltip>
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
            <Tooltip content={t('explorer.clearSearch')}>
              <button onClick={() => setSearch('')} aria-label={t('explorer.clearSearch')}>
                <X size={13} />
              </button>
            </Tooltip>
          )}
        </div>
      )}

      {view === 'connections' ? (
        <>
          <div className="side-section side-section--conns">
            <div className="side-section-head">
              <span className="side-section-title">Connections</span>
              <span className="library-count">· {connections.length}</span>
              <Tooltip content={t('explorer.search')}>
                <button
                  className={searchOpen ? 'side-head-action is-active' : 'side-head-action'}
                  aria-label={t('explorer.search')}
                  aria-pressed={searchOpen}
                  onClick={() => {
                    if (searchOpen) setSearch('')
                    setSearchOpen((open) => !open)
                  }}
                >
                  <Search size={16} />
                </button>
              </Tooltip>
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
                    isActive={selectedRowId === row.id}
                    onActivate={() => setSelectedRowId(row.id)}
                    onToggle={() => toggleConnectionExpanded(row.id)}
                    onConnect={() => void connect(row.id)}
                    onMove={moveConnection}
                    onContextMenu={(e) => openConnMenu(e, row)}
                  />
                ) : (
                  <CatalogRow
                    key={row.id}
                    row={row}
                    isActive={selectedRowId === row.id}
                    onActivate={() => setSelectedRowId(row.id)}
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
        <Tooltip
          content={
            theme === 'system'
              ? t('explorer.theme.system')
              : theme === 'light'
                ? t('explorer.theme.light')
                : t('explorer.theme.dark')
          }
        >
          <button
            className="theme-cycle"
            aria-label={t('explorer.toggleTheme')}
            onClick={() =>
              void updateSettings({
                theme: theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system'
              })
            }
          >
            {theme === 'system' ? <Monitor size={16} /> : theme === 'light' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </Tooltip>
        {availableVersion ? (
          <button
            type="button"
            className="side-foot-update"
            title={
              updateState.phase === 'downloaded'
                ? t('updates.restartToUpdate')
                : t('updates.newVersion', { version: availableVersion })
            }
            aria-label={
              updateState.phase === 'downloaded'
                ? t('updates.restartToUpdate')
                : t('updates.updateTo', { version: availableVersion })
            }
            disabled={updateState.phase === 'downloading'}
            onClick={() => void showAvailableUpdate()}
          >
            {updateState.phase === 'downloading' ? (
              <Loader2 className="animate-spin" size={13} aria-hidden />
            ) : updateState.phase === 'downloaded' ? (
              <RefreshCw size={13} aria-hidden />
            ) : (
              <Download size={13} aria-hidden />
            )}
            <span className="side-foot-update-label">
              {updateState.phase === 'downloading'
                ? t('updates.downloading', {
                    percent: Math.round(updateState.downloadProgress?.percent ?? 0)
                  })
                : updateState.phase === 'downloaded'
                  ? t('updates.restartToUpdate')
                  : t('updates.updateTo', { version: availableVersion })}
            </span>
          </button>
        ) : (
          <span className="side-foot-build" title={__BUILD_ID__}>
            {__BUILD_ID__}
          </span>
        )}
        <Tooltip content={t('common.settings')}>
          <button className="theme-cycle" aria-label={t('common.settings')} onClick={onSettings}>
            <Settings size={16} />
          </button>
        </Tooltip>
      </div>

      {connForm.open && <ConnectionForm editing={connForm.editing} onClose={() => setConnForm({ open: false })} />}

      {ioModal && ioModal.mode === 'export' && (
        <ExportModal
          source={{
            kind: 'collection',
            connectionId: ioModal.connId,
            database: ioModal.db,
            collection: ioModal.collection
          }}
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
      {schemaTarget && <SchemaModelModal target={schemaTarget} onClose={() => setSchemaTarget(null)} />}
      {ctxMenu && <ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={ctxMenu.items} onClose={() => setCtxMenu(null)} />}
    </div>
  )
}

function ConnectionRow({
  row,
  isActive,
  onActivate,
  onToggle,
  onConnect,
  onMove,
  onContextMenu
}: {
  row: ConnRow
  isActive: boolean
  onActivate: () => void
  onToggle: () => void
  onConnect: () => void
  onMove: (sourceId: string, targetId: string, edge: DropEdge) => void
  onContextMenu: (e: MouseEvent) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [dragging, setDragging] = useState(false)
  const [dropEdge, setDropEdge] = useState<DropEdge | null>(null)
  const { conn, state, error, expandable, expanded } = row
  const isConnected = state === 'connected'
  const sub = conn.useSrv ? `srv · ${conn.host}` : formatMongoHosts(conn.host, conn.port ?? 27017)

  // The lone surviving piece of chrome: a single status signal whose color +
  // glow carry the live state. Actions stay in the right-click menu.
  const signalClass = `conn-signal conn-signal--${
    state === 'connected' ? 'on' : state === 'error' ? 'error' : state === 'connecting' ? 'connecting' : 'off'
  }`
  const statusLabel =
    state === 'error' && error ? `${t('connection.status.error')}: ${error}` : t(`connection.status.${state}`)

  return (
    <div
      className={`conn-item${isActive ? ' active' : ''}${dragging ? ' dragging' : ''}${dropEdge ? ` drop-${dropEdge}` : ''}`}
      draggable
      aria-grabbed={dragging}
      onClickCapture={onActivate}
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
        {expandable ? <ChevronRight size={14} className={expanded ? 'twisty-icon open' : 'twisty-icon'} /> : null}
      </span>
      <div className="conn-text">
        <div
          className="conn-name"
          style={{ color: conn.color ? `color-mix(in srgb, ${conn.color} 60%, var(--text-secondary))` : undefined }}
        >
          {conn.name}
        </div>
        <Tooltip content={sub} overflowOnly>
          <div className="conn-sub">{sub}</div>
        </Tooltip>
      </div>
      <Tooltip content={statusLabel}>
        <span className="conn-status" role="status" aria-label={statusLabel}>
          <span className={signalClass} />
        </span>
      </Tooltip>
    </div>
  )
}

function CatalogRow({
  row,
  isActive,
  onActivate,
  onContextMenu
}: {
  row: TreeRow
  isActive: boolean
  onActivate: () => void
  onContextMenu: (e: MouseEvent, row: TreeRow) => void
}): React.JSX.Element {
  const coll = row.collection
  const isNote = row.kind === 'leaf'
  const className =
    'tree-node' +
    (isActive ? ' active' : '') +
    (row.empty ? ' tree-node--empty' : '') +
    (isNote ? ' tree-node--note' : '')
  const tooltipContent = isNote
    ? undefined
    : (row.tooltip ?? (row.empty ? `${row.label} — empty (no collections yet)` : row.label))
  return (
    <div
      className={className}
      style={{ paddingLeft: 8 + row.depth * 14 }}
      onClickCapture={row.onClick || row.onDoubleClick ? onActivate : undefined}
      onClick={row.onClick}
      onDoubleClick={row.onDoubleClick}
      onContextMenu={
        row.kind === 'database' || row.kind === 'indexes' || row.kind === 'index' || coll
          ? (e) => onContextMenu(e, row)
          : undefined
      }
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
      <Tooltip content={tooltipContent} overflowOnly={!isNote && !row.empty && !row.tooltip}>
        <span className="tree-label">{row.label}</span>
      </Tooltip>
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

/** Query one index's complete definition, making its connection active first. */
function inspectIndex(a: RowActions, connId: string, db: string, coll: string, indexName: string): void {
  a.setActiveConnection(connId)
  a.inspectIndex(db, coll, indexName)
}

/** Toggle a database node without changing the work area's active tab. */
function openDatabase(a: RowActions, connId: string, db: string, nodeId: string): void {
  void a.toggleNode(connId, nodeId, 'database', { db })
}

/**
 * Flatten one connection's expanded catalog into ordered rows (depth ≥ 1).
 * Mirrors the old CatalogTree builder, offset one level under the connection.
 */
function flattenCatalog(connId: string, cat: CatalogState, a: RowActions, sort: CollectionSort): TreeRow[] {
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
    // Do not render the trailing Users folder before collection loading finishes.
    // Otherwise it appears as the database's first child, then jumps below the
    // entire collection list when that list arrives, which looks like a re-sort.
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
        icon: coll.type === 'view' ? 'view' : coll.type === 'timeseries' ? 'timeseries' : 'collection',
        kind: 'collection',
        expandable: true,
        expanded: collExpanded,
        loading: cat.loading.has(collNodeId),
        count: coll.estimatedCount,
        approximateCount: coll.estimatedCount !== undefined,
        collection: { db: db.name, name: coll.name, type: coll.type },
        // Toggle expands sub-folders; double-clicking the row opens the query tab.
        onToggle: () =>
          void a.toggleNode(connId, collNodeId, 'collection', {
            db: db.name,
            coll: coll.name
          }),
        onDoubleClick: () => browseCollection(a, connId, db.name, coll.name)
      })

      if (!collExpanded) continue

      const idxKey = `${db.name}/${coll.name}`
      const idxList = cat.indexes[idxKey]
      // Initial metadata loading updates the count and indexes atomically. Keep
      // the subtree closed until both are ready so an empty Indexes folder does
      // not flash briefly before its count appears.
      if (cat.loading.has(collNodeId) && idxList === undefined) continue

      // Indexes folder
      const idxNodeId = `${connId}:idx:${db.name}/${coll.name}`
      const idxExpanded = cat.expanded.has(idxNodeId)
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
        indexCollection: { db: db.name, name: coll.name },
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
            tooltip: ix.name,
            indexName: ix.name,
            icon: 'index',
            kind: 'index',
            expandable: false,
            expanded: false,
            loading: false,
            onDoubleClick: () => inspectIndex(a, connId, db.name, coll.name, ix.name)
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
