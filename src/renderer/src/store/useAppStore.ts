/**
 * The single source of truth for the renderer.
 *
 * Holds: connections, the active connection, per-connection status,
 * the lazily-loaded catalog tree state, the active database, the shell editor
 * code, per-tab result strips, the chosen result view, and loading/error flags.
 *
 * All backend access happens here via `window.api`; components dispatch actions
 * and read state. Every async action catches rejections and surfaces relevant
 * failures through the bounded notification queue or contextual result state.
 */
import { create } from 'zustand'
import { DEFAULT_SETTINGS } from '@shared/types'
import type {
  AppSettings,
  CollectionInfo,
  ConnectionConfig,
  ConnectionInput,
  ConnectionStatus,
  DatabaseInfo,
  DataOpResult,
  DiagnoseScope,
  DiagnoseStage,
  DocReadRequest,
  DocReadResult,
  DocMutateRequest,
  DocMutateResult,
  DocSetFieldRequest,
  DocUpdateRequest,
  ExportDirectorySelection,
  ExportFileRequest,
  ExportProgress,
  HistoryEntry,
  ImportRequest,
  IndexInfo,
  MongoJsonSchema,
  SavedQuery,
  SavedQueryInput,
  SchemaModel,
  SchemaTarget,
  ShellResult,
  TestResult,
  UpdateState,
  UserInfo
} from '@shared/types'
import {
  activeResult,
  appendResult,
  closeResult,
  createTab,
  dbCollRef,
  indexDetailsQuery,
  isRunFailure,
  patchResult,
  patchTab,
  pickActiveAfterClose,
  pickFillTarget,
  type QueryTab,
  type ResultTab
} from '@renderer/lib/tabs'
import {
  dismissNotification as removeNotification,
  enqueueNotification,
  type AppNotification,
  type NotificationInput,
  type NotificationSource,
  type NotificationVariant
} from '@renderer/lib/notifications'
import i18n from '@renderer/i18n'

/** Shorthand for translating notification / error strings in the store. */
const tr = i18n.t.bind(i18n)

export type { QueryTab, ResultTab }

export type ResultView = 'tree' | 'json' | 'table'

/** Loaded children for a catalog node, keyed by a synthetic node id. */
export interface CatalogState {
  /** db name -> collections (undefined = not loaded yet). */
  collections: Record<string, CollectionInfo[] | undefined>
  /** `${db}` -> databases loaded flag handled separately. */
  databases?: DatabaseInfo[]
  /** `${db}/${coll}` -> indexes. */
  indexes: Record<string, IndexInfo[] | undefined>
  /** `${db}` -> users. */
  users: Record<string, UserInfo[] | undefined>
  /** Set of expanded node ids in the tree. */
  expanded: Set<string>
  /** Set of node ids currently loading. */
  loading: Set<string>
}

function emptyCatalog(): CatalogState {
  return {
    collections: {},
    databases: undefined,
    indexes: {},
    users: {},
    expanded: new Set(),
    loading: new Set()
  }
}

interface AppState {
  // ---- connections ----
  connections: ConnectionConfig[]
  statuses: Record<string, ConnectionStatus>
  activeConnectionId: string | null

  // ---- catalog (per connection) ----
  catalogs: Record<string, CatalogState>
  /** Connection ids whose database subtree is expanded in the unified explorer. */
  expandedConnections: Set<string>

  // ---- shell workspace (multi-tab) ----
  /** Open query tabs; each carries its own code/db/run state plus a strip of
      result tabs (one per run, capped — see lib/tabs MAX_RESULT_TABS). */
  tabs: QueryTab[]
  /** Id of the focused tab (always references an existing tab; ≥1 tab exists). */
  activeTabId: string
  /** Result view (Tree/JSON/Table) — a global UI preference, not per-tab. */
  resultView: ResultView

  // ---- saved queries + history + autocomplete (Phase 2) ----
  savedQueries: SavedQuery[]
  history: HistoryEntry[]
  /** Sampled field names for autocomplete, keyed `${connId}:${db}.${coll}`. */
  fieldCache: Record<string, string[]>

  // ---- preferences ----
  settings: AppSettings
  updateState: UpdateState

  // ---- ui ----
  initializing: boolean
  notifications: AppNotification[]

  // ---- actions: bootstrap ----
  bootstrap(): Promise<void>
  loadConnections(): Promise<void>

  // ---- actions: connection crud ----
  saveConnection(input: ConnectionInput): Promise<ConnectionConfig | null>
  deleteConnection(id: string): Promise<void>
  testConnection(input: ConnectionInput): Promise<TestResult>
  /** Build a connection string from the current form fields ("To URL"). */
  buildConnectionUri(input: ConnectionInput, opts: { includePassword: boolean }): Promise<string | null>
  /** Open a native file picker (e.g. SSH private key); resolves the path or null. */
  pickFile(opts?: { title?: string; defaultPath?: string }): Promise<string | null>
  /** Run a single-hop SSH connectivity check (target or jump) for the form fields. */
  diagnoseConnection(input: ConnectionInput, scope: DiagnoseScope): Promise<DiagnoseStage[]>

  // ---- actions: session ----
  connect(id: string): Promise<void>
  disconnect(id: string): Promise<void>
  syncSessionStatus(status: ConnectionStatus): void
  setActiveConnection(id: string | null): void
  /** Expand/collapse a connection's database subtree in the explorer. */
  toggleConnectionExpanded(id: string): void

  // ---- actions: catalog ----
  toggleNode(connId: string, nodeId: string, kind: NodeKind, payload: NodePayload): Promise<void>
  loadDatabases(connId: string): Promise<void>
  loadCollections(connId: string, db: string): Promise<void>
  /** Refresh one collection's estimated document count and indexes together. */
  refreshCollection(connId: string, db: string, coll: string): Promise<void>
  loadIndexes(connId: string, db: string, coll: string): Promise<void>
  loadUsers(connId: string, db: string): Promise<void>

  // ---- actions: tabs ----
  /** Open a new empty query tab and focus it. */
  newTab(): void
  /** Focus an existing tab. */
  setActiveTab(id: string): void
  /** Close a tab (aborts its run if any); always leaves ≥1 tab open. */
  closeTab(id: string): void

  // ---- actions: result tabs (operate on the active query tab) ----
  /** Focus one of the active tab's result tabs. */
  setActiveResultTab(id: string): void
  /** Close one of the active tab's result tabs. */
  closeResultTab(id: string): void

  // ---- actions: shell (operate on the active tab) ----
  setCode(code: string): void
  formatCode(): Promise<void>
  setActiveDatabase(db: string): void
  setResultView(view: ResultView): void
  /** Browse a collection from the explorer: run a bounded newest-first query
      on first fill; focus an identical browse tab without re-running it. */
  browseCollection(db: string, coll: string): void
  /** Open and run a query for one index's complete server-side definition. */
  inspectIndex(db: string, coll: string, indexName: string): void
  /** Run the editor's script, or `codeOverride` when given (e.g. the current
      statement / selection from the right-click menu). */
  runShell(codeOverride?: string): Promise<void>
  /** Cancel the in-flight run (the Stop button / menu item). No-op when idle. */
  stopShell(): Promise<void>
  runExplain(): Promise<void>
  /** Re-run the active result tab's query in place (same page offset). */
  refreshResult(): Promise<void>
  /** Re-run the active result tab's query at a new page offset (prev/next),
      patching that result tab in place. Only meaningful when `pageable`. */
  loadPage(skip: number): Promise<void>
  /** Change the page size and re-run the current query from the first page. */
  setQueryLimit(n: number): Promise<void>
  notify(input: NotificationInput): void
  dismissNotification(id: string): void
  clearNotifications(): void

  // ---- actions: saved queries + history (Phase 2) ----
  loadQueries(): Promise<void>
  saveQuery(input: SavedQueryInput): Promise<SavedQuery | null>
  deleteQuery(id: string): Promise<void>
  loadHistory(): Promise<void>
  clearHistory(): Promise<void>
  /** Load a query/history snippet into its connection-bound editor (never auto-runs). */
  applyQuery(code: string, database?: string, connectionId?: string): void

  // ---- actions: autocomplete (Phase 2) ----
  /** Fetch (and cache) sampled field names for a collection. */
  sampleFields(connId: string, db: string, coll: string): Promise<string[]>
  /** Synchronous read of cached field names (for completion sources). */
  getFields(connId: string, db: string, coll: string): string[]

  // ---- actions: Schema analysis / local model ----
  loadSchemaModel(target: SchemaTarget): Promise<SchemaModel | null>
  analyzeSchema(target: SchemaTarget): Promise<SchemaModel | null>
  saveSchemaDraft(target: SchemaTarget, draft: MongoJsonSchema): Promise<SchemaModel | null>
  overwriteSchemaDraft(target: SchemaTarget): Promise<SchemaModel | null>

  // ---- actions: document read/edit/delete (Phase 2) ----
  readDocument(req: DocReadRequest): Promise<DocReadResult>
  cancelDocumentRead(taskId: string): Promise<boolean>
  updateDocument(req: DocUpdateRequest): Promise<DocMutateResult>
  setDocumentField(req: DocSetFieldRequest): Promise<DocMutateResult>
  deleteDocument(req: DocMutateRequest): Promise<DocMutateResult>

  // ---- actions: import/export (Phase 3) ----
  exportProgress: Record<string, ExportProgress | undefined>
  chooseExportDirectory(): Promise<ExportDirectorySelection | null>
  exportCollection(req: ExportFileRequest): Promise<DataOpResult>
  cancelExport(taskId: string): Promise<boolean>
  openExportedFile(taskId: string): Promise<string | null>
  revealExportedFile(taskId: string): Promise<string | null>
  clearExportProgress(taskId: string): void
  importCollection(req: ImportRequest): Promise<DataOpResult>

  // ---- actions: preferences ----
  checkForUpdates(): Promise<boolean>
  loadUpdateState(): Promise<void>
  setAutomaticUpdateChecks(enabled: boolean): Promise<void>
  showAvailableUpdate(): Promise<boolean>
  openSettings(): Promise<void>
  loadSettings(): Promise<void>
  updateSettings(patch: Partial<AppSettings>): Promise<void>
}

export type NodeKind = 'database' | 'collection' | 'indexes' | 'users'
export interface NodePayload {
  db?: string
  coll?: string
}

function statusFor(connId: string, statuses: Record<string, ConnectionStatus>): ConnectionStatus {
  return statuses[connId] ?? { id: connId, state: 'disconnected' }
}

function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  return 'Unknown error'
}

function appNotice(
  variant: NotificationVariant,
  title: string,
  source: NotificationSource,
  dedupeKey?: string,
  detail?: string
): NotificationInput {
  return { variant, title, source, dedupeKey, detail }
}

function shellFailureNotice(result: ShellResult, tabId: string): NotificationInput | null {
  if (result.kind !== 'error' || result.errorName === 'Aborted' || result.failureKind === 'cancelled') {
    return null
  }
  return appNotice(
    'error',
    result.failureKind === 'timeout' ? tr('notify.queryTimeout') : tr('notify.queryFailed'),
    'query',
    `query:${tabId}:${result.failureKind ?? result.errorName ?? 'unknown'}`,
    result.error ?? tr('notify.unknown')
  )
}

/** Opaque per-run id so a run can be cancelled via `shell.abort` (Stop). */
function newExecId(): string {
  return crypto.randomUUID()
}

/** Stable id for a new tab. */
function newTabId(): string {
  return crypto.randomUUID()
}

/** Stable id for a new result tab. */
function newResultId(): string {
  return crypto.randomUUID()
}

/** The focused tab. Always defined — the store guarantees ≥1 tab exists; the
    `?? tabs[0]` is just a belt-and-suspenders for a stale activeTabId. */
export function getActiveTab(s: { tabs: QueryTab[]; activeTabId: string }): QueryTab {
  return s.tabs.find((t) => t.id === s.activeTabId) ?? s.tabs[0]
}

/** The active tab's focused result tab (null = nothing has run yet). */
export function getActiveResult(s: { tabs: QueryTab[]; activeTabId: string }): ResultTab | null {
  return activeResult(getActiveTab(s))
}

/** Apply a result-strip patch (append/patch/close) to one tab by id, reading
    the tab's CURRENT state inside `set` so concurrent runs don't clobber. */
function patchTabResults(
  s: { tabs: QueryTab[] },
  tabId: string,
  make: (tab: QueryTab) => Partial<QueryTab>
): { tabs: QueryTab[] } | Record<string, never> {
  const tab = s.tabs.find((t) => t.id === tabId)
  if (!tab) return {}
  return { tabs: patchTab(s.tabs, tabId, make(tab)) }
}

/** The tab present at first render (so init can point activeTabId at it). */
const INITIAL_TAB = createTab(newTabId())

/** Concurrent callers share one session attempt instead of opening duplicate
    clients/tunnels for the same Connection. */
const connectionAttempts = new Map<string, { promise: Promise<void>; token: object }>()

// Settings live in a separate BrowserWindow, hence a separate Zustand store.
// BroadcastChannel is the native, dependency-free bridge between same-origin
// renderer windows; the main process remains the persistence authority.
let settingsChannel: BroadcastChannel | null | undefined
let settingsSubscribed = false
let updatesSubscribed = false
let exportProgressSubscribed = false

function getSettingsChannel(): BroadcastChannel | null {
  if (settingsChannel !== undefined) return settingsChannel
  settingsChannel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('amdm-settings')
  return settingsChannel
}

function subscribeToSettings(): void {
  if (settingsSubscribed) return
  const channel = getSettingsChannel()
  if (!channel) return
  settingsSubscribed = true
  channel.addEventListener('message', (event: MessageEvent<AppSettings>) => {
    const historyLimitChanged = useAppStore.getState().settings.historyLimit !== event.data.historyLimit
    useAppStore.setState({ settings: event.data })
    if (historyLimitChanged) void useAppStore.getState().loadHistory()
  })
}

function subscribeToUpdates(): void {
  if (updatesSubscribed) return
  updatesSubscribed = true
  window.api.updates.onStateChanged((updateState) => {
    useAppStore.setState({ updateState })
  })
}

function subscribeToExportProgress(): void {
  if (exportProgressSubscribed) return
  exportProgressSubscribed = true
  window.api.io.onExportProgress((progress) => {
    useAppStore.setState((state) => ({
      exportProgress: { ...state.exportProgress, [progress.taskId]: progress }
    }))
  })
}

const EMPTY_UPDATE_STATE: UpdateState = {
  available: false,
  automaticallyChecksForUpdates: false,
  availableVersion: null
}

export const useAppStore = create<AppState>((set, get) => ({
  connections: [],
  statuses: {},
  activeConnectionId: null,

  catalogs: {},
  expandedConnections: new Set(),

  tabs: [INITIAL_TAB],
  activeTabId: INITIAL_TAB.id,
  resultView: 'tree',

  savedQueries: [],
  history: [],
  fieldCache: {},

  settings: DEFAULT_SETTINGS,
  updateState: EMPTY_UPDATE_STATE,

  initializing: true,
  notifications: [],
  exportProgress: {},

  // --------------------------------------------------------------------- boot
  async bootstrap() {
    subscribeToExportProgress()
    set({ initializing: true })
    await Promise.all([
      get().loadConnections(),
      get().loadQueries(),
      get().loadHistory(),
      get().loadSettings(),
      get().loadUpdateState()
    ])
    set({ initializing: false })
  },

  async loadConnections() {
    try {
      const connections = await window.api.connections.list()
      set({ connections })
    } catch (e) {
      get().notify(
        appNotice(
          'error',
          tr('notify.loadConnectionsFailed', { error: errMessage(e) }),
          'connection',
          'connections:load'
        )
      )
    }
  },

  // ----------------------------------------------------------------- conn crud
  async saveConnection(input) {
    try {
      const saved = await window.api.connections.save(input)
      await get().loadConnections()
      return saved
    } catch (e) {
      get().notify(appNotice('error', tr('notify.saveConnectionFailed', { error: errMessage(e) }), 'connection'))
      return null
    }
  },

  async deleteConnection(id) {
    try {
      await window.api.connections.delete(id)
      set((s) => {
        const { [id]: _removedCatalog, ...catalogs } = s.catalogs
        const { [id]: _removedStatus, ...statuses } = s.statuses
        const expandedConnections = new Set(s.expandedConnections)
        expandedConnections.delete(id)
        const tabs = s.tabs.map((tab) => (tab.connectionId === id ? { ...tab, connectionId: null } : tab))
        return {
          catalogs,
          statuses,
          tabs,
          expandedConnections,
          activeConnectionId: s.activeConnectionId === id ? null : s.activeConnectionId
        }
      })
      await get().loadConnections()
    } catch (e) {
      get().notify(
        appNotice(
          'error',
          tr('notify.deleteConnectionFailed', { error: errMessage(e) }),
          'connection',
          `connection:${id}:delete`
        )
      )
    }
  },

  async testConnection(input) {
    try {
      return await window.api.connections.test(input)
    } catch (e) {
      const error = errMessage(e)
      get().notify(appNotice('error', tr('notify.testConnectionFailed'), 'connection', 'connection:test', error))
      return { ok: false, error, failureKind: 'ipc' }
    }
  },

  async buildConnectionUri(input, opts) {
    try {
      return await window.api.connections.buildUri(input, opts)
    } catch (e) {
      get().notify(appNotice('error', tr('notify.buildUriFailed', { error: errMessage(e) }), 'connection'))
      return null
    }
  },

  async pickFile(opts) {
    try {
      return await window.api.dialog.openFile(opts)
    } catch (e) {
      get().notify(appNotice('error', tr('notify.pickFileFailed', { error: errMessage(e) }), 'io', 'dialog:openFile'))
      return null
    }
  },

  async diagnoseConnection(input, scope) {
    try {
      return await window.api.connections.diagnose(input, scope)
    } catch (e) {
      get().notify(appNotice('error', tr('notify.diagnoseFailed', { error: errMessage(e) }), 'connection'))
      return []
    }
  },

  // ------------------------------------------------------------------- session
  async connect(id) {
    const pending = connectionAttempts.get(id)
    if (pending && get().statuses[id]?.state === 'connecting') return pending.promise

    const token = {}
    const attempt = (async (): Promise<void> => {
      set((s) => {
        const { [id]: _removed, ...catalogs } = s.catalogs
        const expandedConnections = new Set(s.expandedConnections)
        expandedConnections.delete(id)
        return {
          statuses: { ...s.statuses, [id]: { id, state: 'connecting' } },
          catalogs,
          expandedConnections
        }
      })
      try {
        const status = await window.api.session.connect(id)
        // A disconnect or newer retry may have won while this call was pending.
        if (connectionAttempts.get(id)?.token !== token || get().statuses[id]?.state !== 'connecting') return
        set((s) => {
          // Auto-expand the connection in the explorer so its databases appear.
          const expandedConnections = new Set(s.expandedConnections)
          if (status.state === 'connected') expandedConnections.add(id)
          return {
            statuses: { ...s.statuses, [id]: status },
            catalogs: status.state === 'connected' ? { ...s.catalogs, [id]: emptyCatalog() } : s.catalogs,
            expandedConnections
          }
        })
        const statusKey = `connection:${id}:status`
        if (status.state === 'error') {
          get().notify(
            appNotice(
              'error',
              status.failureKind === 'timeout' ? tr('notify.connectTimeout') : tr('notify.connectFailedTitle'),
              'connection',
              statusKey,
              status.error ?? tr('notify.unknown')
            )
          )
        } else if (
          status.state === 'connected' &&
          get().notifications.some(
            (notification) => notification.dedupeKey === statusKey && notification.variant === 'error'
          )
        ) {
          const connection = get().connections.find((item) => item.id === id)
          get().notify(
            appNotice(
              'success',
              tr('notify.connectionRestoredNamed', { name: connection?.name ?? id }),
              'connection',
              statusKey
            )
          )
        }
        if (status.state === 'connected') {
          // Connecting is an explorer action: it must not create or focus a query tab.
          // If this is a reconnect for the active tab, preserve the default-db warmup.
          const conn = get().connections.find((c) => c.id === id)
          const db = conn?.defaultDatabase
          if (db && getActiveTab(get()).connectionId === id) {
            set((s) =>
              getActiveTab(s).activeDatabase ? {} : { tabs: patchTab(s.tabs, s.activeTabId, { activeDatabase: db }) }
            )
          }
          await get().loadDatabases(id)
          // Prefetch the active db's collection names so `db.` completion works
          // without expanding the tree (only that db; skip if already cached).
          const activeTab = getActiveTab(get())
          const activeDb = activeTab.connectionId === id ? activeTab.activeDatabase : ''
          if (activeDb && get().catalogs[id]?.collections[activeDb] === undefined) {
            void get().loadCollections(id, activeDb)
          }
        }
      } catch (e) {
        if (connectionAttempts.get(id)?.token !== token || get().statuses[id]?.state !== 'connecting') return
        const error = errMessage(e)
        set((s) => ({
          statuses: { ...s.statuses, [id]: { id, state: 'error', error, failureKind: 'ipc' } }
        }))
        get().notify(
          appNotice('error', tr('notify.connectFailedTitle'), 'connection', `connection:${id}:status`, error)
        )
      }
    })()

    connectionAttempts.set(id, { promise: attempt, token })
    try {
      await attempt
    } finally {
      if (connectionAttempts.get(id)?.token === token) connectionAttempts.delete(id)
    }
  },

  async disconnect(id) {
    // Update immediately; closing an in-flight driver connection may finish asynchronously.
    set((s) => {
      const { [id]: _removed, ...catalogs } = s.catalogs
      const expandedConnections = new Set(s.expandedConnections)
      expandedConnections.delete(id)
      return {
        statuses: { ...s.statuses, [id]: { id, state: 'disconnected' } },
        catalogs,
        expandedConnections
      }
    })
    try {
      await window.api.session.disconnect(id)
    } catch (e) {
      get().notify(
        appNotice(
          'error',
          tr('notify.disconnectFailed', { error: errMessage(e) }),
          'connection',
          `connection:${id}:disconnect`
        )
      )
    }
  },

  syncSessionStatus(status) {
    const previous = get().statuses[status.id]
    set((s) => ({ statuses: { ...s.statuses, [status.id]: status } }))
    if (previous?.state === status.state) return
    const key = `connection:${status.id}:status`
    if (status.state === 'error') {
      const connection = get().connections.find((item) => item.id === status.id)
      get().notify(
        appNotice(
          'error',
          status.failureKind === 'timeout'
            ? tr('notify.connectionRuntimeTimeout', { name: connection?.name ?? status.id })
            : tr('notify.connectionLost', { name: connection?.name ?? status.id }),
          'connection',
          key,
          status.error ?? tr('notify.unknown')
        )
      )
    } else if (previous?.state === 'error' && status.state === 'connected') {
      const connection = get().connections.find((item) => item.id === status.id)
      get().notify(
        appNotice(
          'success',
          tr('notify.connectionRestoredNamed', { name: connection?.name ?? status.id }),
          'connection',
          key
        )
      )
    }
  },

  setActiveConnection(id) {
    if (id === null) {
      set({ activeConnectionId: null })
      return
    }
    set((s) => {
      const active = getActiveTab(s)
      if (active.connectionId === id) return { activeConnectionId: id }
      const existing = s.tabs.find((tab) => tab.connectionId === id)
      if (existing) return { activeConnectionId: id, activeTabId: existing.id }
      if (active.connectionId === null && active.pristine && active.results.length === 0) {
        return {
          activeConnectionId: id,
          tabs: patchTab(s.tabs, active.id, { connectionId: id })
        }
      }
      const tab = createTab(newTabId(), { connectionId: id })
      return { activeConnectionId: id, tabs: [...s.tabs, tab], activeTabId: tab.id }
    })
  },

  toggleConnectionExpanded(id) {
    set((s) => {
      const expandedConnections = new Set(s.expandedConnections)
      if (expandedConnections.has(id)) expandedConnections.delete(id)
      else expandedConnections.add(id)
      return { expandedConnections }
    })
  },

  // ------------------------------------------------------------------- catalog
  async toggleNode(connId, nodeId, kind, payload) {
    const cat = get().catalogs[connId] ?? emptyCatalog()
    const wasExpanded = cat.expanded.has(nodeId)

    // Collapse: just toggle off, keep cached children.
    if (wasExpanded) {
      set((s) => {
        const c = s.catalogs[connId] ?? emptyCatalog()
        const expanded = new Set(c.expanded)
        expanded.delete(nodeId)
        return { catalogs: { ...s.catalogs, [connId]: { ...c, expanded } } }
      })
      return
    }

    // Expand: mark expanded, then lazily load children if not already cached.
    set((s) => {
      const c = s.catalogs[connId] ?? emptyCatalog()
      const expanded = new Set(c.expanded)
      expanded.add(nodeId)
      return { catalogs: { ...s.catalogs, [connId]: { ...c, expanded } } }
    })

    if (kind === 'database' && payload.db) {
      if (get().catalogs[connId]?.collections[payload.db] === undefined) {
        await get().loadCollections(connId, payload.db)
      }
    } else if (kind === 'collection' && payload.db && payload.coll) {
      const db = payload.db
      const coll = payload.coll
      const collection = get().catalogs[connId]?.collections[db]?.find((item) => item.name === coll)
      if (
        collection &&
        collection.type !== 'view' &&
        collection.estimatedCount === undefined &&
        !get().catalogs[connId]?.loading.has(nodeId)
      ) {
        void get().refreshCollection(connId, db, coll)
      }
    } else if (kind === 'indexes' && payload.db && payload.coll) {
      const key = `${payload.db}/${payload.coll}`
      const cat = get().catalogs[connId]
      if (cat?.indexes[key] === undefined && !cat.loading.has(`${connId}:coll:${key}`)) {
        await get().loadIndexes(connId, payload.db, payload.coll)
      }
    } else if (kind === 'users' && payload.db) {
      if (get().catalogs[connId]?.users[payload.db] === undefined) {
        await get().loadUsers(connId, payload.db)
      }
    }
  },

  async loadDatabases(connId) {
    const nodeId = `${connId}:databases`
    set((s) => withLoading(s, connId, nodeId, true))
    try {
      const databases = await window.api.catalog.databases(connId)
      set((s) => {
        const c = s.catalogs[connId] ?? emptyCatalog()
        return { catalogs: { ...s.catalogs, [connId]: { ...c, databases } } }
      })
    } catch (e) {
      get().notify(
        appNotice(
          'error',
          tr('notify.loadDatabasesFailed', { error: errMessage(e) }),
          'catalog',
          `catalog:${connId}:databases`
        )
      )
    } finally {
      set((s) => withLoading(s, connId, nodeId, false))
    }
  },

  async loadCollections(connId, db) {
    const nodeId = `${connId}:db:${db}`
    set((s) => withLoading(s, connId, nodeId, true))
    try {
      const collections = await window.api.catalog.collections(connId, db)
      set((s) => {
        const c = s.catalogs[connId] ?? emptyCatalog()
        return {
          catalogs: {
            ...s.catalogs,
            [connId]: { ...c, collections: { ...c.collections, [db]: collections } }
          }
        }
      })
    } catch (e) {
      get().notify(
        appNotice(
          'error',
          tr('notify.loadCollectionsFailed', { db, error: errMessage(e) }),
          'catalog',
          `catalog:${connId}:${db}:collections`
        )
      )
    } finally {
      set((s) => withLoading(s, connId, nodeId, false))
    }
  },

  async refreshCollection(connId, db, coll) {
    const nodeId = `${connId}:coll:${db}/${coll}`
    const catalog = get().catalogs[connId]
    const collection = catalog?.collections[db]?.find((item) => item.name === coll)
    if (!collection || collection.type === 'view' || catalog.loading.has(nodeId)) return

    set((s) => withLoading(s, connId, nodeId, true))
    try {
      const [estimatedCount, indexes] = await Promise.all([
        window.api.catalog.collectionCount(connId, db, coll),
        window.api.catalog.indexes(connId, db, coll)
      ])
      set((s) => {
        const c = s.catalogs[connId]
        const collections = c?.collections[db]
        if (!c || !collections?.includes(collection)) return {}
        return {
          catalogs: {
            ...s.catalogs,
            [connId]: {
              ...c,
              collections: {
                ...c.collections,
                [db]: collections.map((item) => (item.name === coll ? { ...item, estimatedCount } : item))
              },
              indexes: { ...c.indexes, [`${db}/${coll}`]: indexes }
            }
          }
        }
      })
    } catch (e) {
      get().notify(
        appNotice(
          'error',
          tr('notify.refreshFailed', { error: errMessage(e) }),
          'catalog',
          `catalog:${connId}:${db}:${coll}:refresh`
        )
      )
    } finally {
      set((s) => (s.catalogs[connId] ? withLoading(s, connId, nodeId, false) : {}))
    }
  },

  async loadIndexes(connId, db, coll) {
    const key = `${db}/${coll}`
    const nodeId = `${connId}:idx:${key}`
    set((s) => withLoading(s, connId, nodeId, true))
    try {
      const indexes = await window.api.catalog.indexes(connId, db, coll)
      set((s) => {
        const c = s.catalogs[connId] ?? emptyCatalog()
        return {
          catalogs: {
            ...s.catalogs,
            [connId]: { ...c, indexes: { ...c.indexes, [key]: indexes } }
          }
        }
      })
    } catch (e) {
      get().notify(
        appNotice(
          'error',
          tr('notify.loadIndexesFailed', { key, error: errMessage(e) }),
          'catalog',
          `catalog:${connId}:${key}:indexes`
        )
      )
    } finally {
      set((s) => withLoading(s, connId, nodeId, false))
    }
  },

  async loadUsers(connId, db) {
    const nodeId = `${connId}:users:${db}`
    set((s) => withLoading(s, connId, nodeId, true))
    try {
      const users = await window.api.catalog.users(connId, db)
      set((s) => {
        const c = s.catalogs[connId] ?? emptyCatalog()
        return {
          catalogs: { ...s.catalogs, [connId]: { ...c, users: { ...c.users, [db]: users } } }
        }
      })
    } catch (e) {
      get().notify(
        appNotice(
          'error',
          tr('notify.loadUsersFailed', { db, error: errMessage(e) }),
          'catalog',
          `catalog:${connId}:${db}:users`
        )
      )
    } finally {
      set((s) => withLoading(s, connId, nodeId, false))
    }
  },

  // ---------------------------------------------------------------------- tabs
  newTab() {
    const tab = createTab(newTabId(), { connectionId: get().activeConnectionId })
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }))
  },

  setActiveTab(id) {
    set((s) => {
      const tab = s.tabs.find((item) => item.id === id)
      return tab ? { activeTabId: id, activeConnectionId: tab.connectionId } : {}
    })
  },

  closeTab(id) {
    const closing = get().tabs.find((t) => t.id === id)
    // Free a server-side run the closed tab may have had in flight.
    if (closing?.runningExecId) void window.api.shell.abort(closing.runningExecId).catch(() => {})
    set((s) => {
      const remaining = s.tabs.filter((t) => t.id !== id)
      if (remaining.length === 0) {
        const fresh = createTab(newTabId(), { connectionId: s.activeConnectionId })
        return { tabs: [fresh], activeTabId: fresh.id }
      }
      const nextActive = pickActiveAfterClose(s.tabs, s.activeTabId, id) ?? remaining[0].id
      const activeConnectionId = remaining.find((tab) => tab.id === nextActive)?.connectionId ?? null
      return { tabs: remaining, activeTabId: nextActive, activeConnectionId }
    })
  },

  // --------------------------------------------------------------- result tabs
  setActiveResultTab(id) {
    set((s) => ({ tabs: patchTab(s.tabs, s.activeTabId, { activeResultId: id }) }))
  },

  closeResultTab(id) {
    set((s) => patchTabResults(s, s.activeTabId, (t) => closeResult(t, id)))
  },

  // --------------------------------------------------------------------- shell
  // All shell actions read/write the *active* tab. Async runs capture their
  // tab id up front and patch THAT tab on completion, so switching tabs (or
  // running another) mid-flight stays correct and tabs run independently.
  setCode(code) {
    // Only real user edits reach here (the editor skips external value syncs),
    // so typing permanently marks the tab as holding user work.
    set((s) => ({ tabs: patchTab(s.tabs, s.activeTabId, { code, pristine: false }) }))
  },

  // Pretty-print the editor's JS with Prettier (lazy-loaded). A syntax error
  // surfaces through the notification queue rather than throwing into UI.
  async formatCode() {
    const tab = getActiveTab(get())
    const code = tab.code
    if (!code.trim()) return
    try {
      const { formatJs } = await import('@renderer/lib/formatJs')
      const formatted = await formatJs(code)
      if (formatted !== code) set((s) => ({ tabs: patchTab(s.tabs, tab.id, { code: formatted }) }))
    } catch (e) {
      get().notify(
        appNotice('error', tr('notify.formatFailed', { error: errMessage(e) }), 'query', `query:${tab.id}:format`)
      )
    }
  },

  setActiveDatabase(db) {
    set((s) => ({ tabs: patchTab(s.tabs, s.activeTabId, { activeDatabase: db }) }))
    // Warm the new db's collection names for `db.` completion (skip if cached).
    const connId = getActiveTab(get()).connectionId
    if (connId && db && get().catalogs[connId]?.collections[db] === undefined) {
      void get().loadCollections(connId, db)
    }
  },

  setResultView(view) {
    set({ resultView: view })
  },

  browseCollection(db, coll) {
    const seed = `${dbCollRef(coll)}.find({}).sort({ _id: -1 }).limit(100)`
    let shouldRun = false
    set((s) => {
      const connectionId = getActiveTab(s).connectionId
      if (!connectionId) return {}
      const { focusId, reuseId } = pickFillTarget(s.tabs, s.activeTabId, {
        connectionId,
        database: db,
        code: seed
      })
      if (focusId) return { activeTabId: focusId }
      shouldRun = true
      if (reuseId) return { tabs: patchTab(s.tabs, reuseId, { activeDatabase: db, code: seed }) }
      const tab = createTab(newTabId(), { connectionId, activeDatabase: db, code: seed })
      return { tabs: [...s.tabs, tab], activeTabId: tab.id }
    })
    if (shouldRun) void get().runShell()
  },

  inspectIndex(db, coll, indexName) {
    const code = indexDetailsQuery(coll, indexName)
    let shouldRun = false
    set((s) => {
      const connectionId = getActiveTab(s).connectionId
      if (!connectionId) return {}
      const { focusId, reuseId } = pickFillTarget(s.tabs, s.activeTabId, {
        connectionId,
        database: db,
        code
      })
      if (focusId) {
        shouldRun = s.tabs.find((tab) => tab.id === focusId)?.running !== true
        return { activeTabId: focusId }
      }
      shouldRun = true
      if (reuseId) return { tabs: patchTab(s.tabs, reuseId, { activeDatabase: db, code }) }
      const tab = createTab(newTabId(), { connectionId, activeDatabase: db, code })
      return { tabs: [...s.tabs, tab], activeTabId: tab.id }
    })
    if (shouldRun) void get().runShell()
  },

  async runShell(codeOverride) {
    const tab = getActiveTab(get())
    const connectionId = tab.connectionId
    const tabId = tab.id
    const code = codeOverride ?? tab.code
    if (!connectionId) {
      get().notify(appNotice('warn', tr('notify.noActiveConnection'), 'query', 'query:noConnection'))
      return
    }
    if (!code.trim()) return
    const database = tab.activeDatabase || 'test'
    const { queryLimit: limit, queryTimeoutMS: timeoutMS } = get().settings
    const execId = newExecId()
    set((s) => ({
      tabs: patchTab(s.tabs, tabId, {
        running: true,
        stopping: false,
        runFailed: false,
        runningExecId: execId
      })
    }))
    const query = { connectionId, database, code }
    let runFailed = false
    try {
      // A fresh run always starts at page 0 and lands in a NEW result tab, so
      // earlier results stay around for side-by-side comparison.
      const result = await window.api.shell.execute({ ...query, limit, timeoutMS, skip: 0, execId })
      runFailed = isRunFailure(result)
      set((s) => patchTabResults(s, tabId, (t) => appendResult(t, newResultId(), result, query)))
      const notification = shellFailureNotice(result, tabId)
      if (notification) get().notify(notification)
      // `use <db>` REPL command: switch the tab's active database (also warms
      // its collection names for completion via setActiveDatabase).
      if (result.useDatabase) get().setActiveDatabase(result.useDatabase)
    } catch (e) {
      runFailed = true
      const result: ShellResult = {
        kind: 'error',
        error: errMessage(e),
        errorName: 'IPCError',
        failureKind: 'ipc'
      }
      set((s) => patchTabResults(s, tabId, (t) => appendResult(t, newResultId(), result, query)))
      get().notify(shellFailureNotice(result, tabId)!)
    } finally {
      set((s) => ({
        tabs: patchTab(s.tabs, tabId, {
          running: false,
          stopping: false,
          runFailed,
          runningExecId: null
        })
      }))
    }
    void get().loadHistory()
  },

  async stopShell() {
    const tab = getActiveTab(get())
    const execId = tab.runningExecId
    if (!execId || tab.stopping) return
    set((s) => ({ tabs: patchTab(s.tabs, tab.id, { stopping: true }) }))
    // Best-effort: the run's own `finally` clears the spinner even if abort
    // races past it (the run already finished).
    try {
      await window.api.shell.abort(execId)
    } catch (e) {
      set((s) => {
        const current = s.tabs.find((t) => t.id === tab.id)
        return current?.runningExecId === execId ? { tabs: patchTab(s.tabs, tab.id, { stopping: false }) } : {}
      })
      get().notify(appNotice('error', tr('notify.stopQueryFailed'), 'query', `query:${tab.id}:stop`, errMessage(e)))
    }
  },

  async loadPage(skip) {
    const tab = getActiveTab(get())
    const tabId = tab.id
    const rt = activeResult(tab)
    if (!rt?.query || skip < 0) return
    // Paging mutates the focused result tab IN PLACE (a page flip is the same
    // result, not a new run). Capture its id so a tab switched mid-flight (or
    // closed — patchResult no-ops then) still lands on the right result.
    const resultId = rt.id
    const query = rt.query
    const { queryLimit: limit, queryTimeoutMS: timeoutMS } = get().settings
    const execId = newExecId()
    set((s) => ({
      tabs: patchTab(s.tabs, tabId, {
        running: true,
        stopping: false,
        runFailed: false,
        runningExecId: execId
      })
    }))
    let runFailed = false
    try {
      const result = await window.api.shell.execute({ ...query, limit, timeoutMS, skip, execId })
      runFailed = isRunFailure(result)
      set((s) => patchTabResults(s, tabId, (t) => patchResult(t, resultId, { result, executedAt: Date.now(), skip })))
      const notification = shellFailureNotice(result, tabId)
      if (notification) get().notify(notification)
    } catch (e) {
      runFailed = true
      const result: ShellResult = {
        kind: 'error',
        error: errMessage(e),
        errorName: 'IPCError',
        failureKind: 'ipc'
      }
      set((s) => patchTabResults(s, tabId, (t) => patchResult(t, resultId, { result })))
      get().notify(shellFailureNotice(result, tabId)!)
    } finally {
      set((s) => ({
        tabs: patchTab(s.tabs, tabId, {
          running: false,
          stopping: false,
          runFailed,
          runningExecId: null
        })
      }))
    }
  },

  async setQueryLimit(n) {
    const limit = Math.min(2000, Math.max(1, Math.floor(n) || 1))
    await get().updateSettings({ queryLimit: limit })
    // Re-run the focused result's query from the first page with the new size.
    if (getActiveResult(get())?.query) await get().loadPage(0)
  },

  async runExplain() {
    const tab = getActiveTab(get())
    const connectionId = tab.connectionId
    const tabId = tab.id
    const code = tab.code
    if (!connectionId) {
      get().notify(appNotice('warn', tr('notify.noActiveConnection'), 'query', 'query:noConnection'))
      return
    }
    if (!code.trim()) return
    const database = tab.activeDatabase || 'test'
    const timeoutMS = get().settings.queryTimeoutMS
    const execId = newExecId()
    set((s) => ({
      tabs: patchTab(s.tabs, tabId, {
        running: true,
        stopping: false,
        runFailed: false,
        runningExecId: execId
      })
    }))
    const query = { connectionId, database, code }
    let runFailed = false
    try {
      const result = await window.api.shell.execute({ ...query, timeoutMS, explain: true, execId })
      runFailed = isRunFailure(result)
      set((s) => patchTabResults(s, tabId, (t) => appendResult(t, newResultId(), result, query)))
      const notification = shellFailureNotice(result, tabId)
      if (notification) get().notify(notification)
    } catch (e) {
      runFailed = true
      const result: ShellResult = {
        kind: 'error',
        error: errMessage(e),
        errorName: 'IPCError',
        failureKind: 'ipc'
      }
      set((s) => patchTabResults(s, tabId, (t) => appendResult(t, newResultId(), result, query)))
      get().notify(shellFailureNotice(result, tabId)!)
    } finally {
      set((s) => ({
        tabs: patchTab(s.tabs, tabId, {
          running: false,
          stopping: false,
          runFailed,
          runningExecId: null
        })
      }))
    }
    void get().loadHistory()
  },

  async refreshResult() {
    const tab = getActiveTab(get())
    const tabId = tab.id
    const rt = activeResult(tab)
    if (!rt?.query) return
    const resultId = rt.id
    const { queryLimit: limit, queryTimeoutMS: timeoutMS } = get().settings
    const execId = newExecId()
    set((s) => ({
      tabs: patchTab(s.tabs, tabId, {
        running: true,
        stopping: false,
        runFailed: false,
        runningExecId: execId
      })
    }))
    let runFailed = false
    try {
      // Refresh the focused result tab in place — keep its page offset and size.
      const result = await window.api.shell.execute({
        ...rt.query,
        limit,
        timeoutMS,
        skip: rt.skip,
        execId
      })
      runFailed = isRunFailure(result)
      set((s) => patchTabResults(s, tabId, (t) => patchResult(t, resultId, { result, executedAt: Date.now() })))
      const notification = shellFailureNotice(result, tabId)
      if (notification) get().notify(notification)
    } catch (e) {
      runFailed = true
      const result: ShellResult = {
        kind: 'error',
        error: errMessage(e),
        errorName: 'IPCError',
        failureKind: 'ipc'
      }
      set((s) => patchTabResults(s, tabId, (t) => patchResult(t, resultId, { result, executedAt: Date.now() })))
      get().notify(shellFailureNotice(result, tabId)!)
    } finally {
      set((s) => ({
        tabs: patchTab(s.tabs, tabId, {
          running: false,
          stopping: false,
          runFailed,
          runningExecId: null
        })
      }))
    }
  },

  notify(input) {
    set((state) => ({
      notifications: enqueueNotification(state.notifications, input, {
        id: crypto.randomUUID(),
        now: Date.now()
      })
    }))
  },

  dismissNotification(id) {
    set((state) => ({ notifications: removeNotification(state.notifications, id) }))
  },

  clearNotifications() {
    set({ notifications: [] })
  },

  // ----------------------------------------------------- saved queries + history
  async loadQueries() {
    try {
      set({ savedQueries: await window.api.queries.list() })
    } catch (e) {
      get().notify(
        appNotice('error', tr('notify.loadSavedQueriesFailed', { error: errMessage(e) }), 'system', 'queries:load')
      )
    }
  },

  async saveQuery(input) {
    try {
      const saved = await window.api.queries.save(input)
      await get().loadQueries()
      get().notify(appNotice('success', tr('notify.saveQuerySuccess', { name: saved.name }), 'query'))
      return saved
    } catch (e) {
      get().notify(appNotice('error', tr('notify.saveQueryFailed', { error: errMessage(e) }), 'query'))
      return null
    }
  },

  async deleteQuery(id) {
    try {
      await window.api.queries.delete(id)
      await get().loadQueries()
    } catch (e) {
      get().notify(
        appNotice('error', tr('notify.deleteQueryFailed', { error: errMessage(e) }), 'query', `query:${id}:delete`)
      )
    }
  },

  async loadHistory() {
    try {
      set({ history: await window.api.history.list() })
    } catch (e) {
      get().notify(
        appNotice('error', tr('notify.loadHistoryFailed', { error: errMessage(e) }), 'system', 'history:load')
      )
    }
  },

  async clearHistory() {
    try {
      await window.api.history.clear()
      set({ history: [] })
    } catch (e) {
      get().notify(appNotice('error', tr('notify.clearHistoryFailed', { error: errMessage(e) }), 'system'))
    }
  },

  applyQuery(code, database, connectionId) {
    // Never auto-run. Loads land like browse seeds: refill
    // the active tab while it's pristine, else open a tab of their own —
    // loading a query must not clobber code the user wrote.
    const targetConnectionId = connectionId ?? get().activeConnectionId
    if (!targetConnectionId) {
      get().notify(appNotice('warn', tr('notify.noActiveConnection'), 'query', 'query:noConnection'))
      return
    }
    set((s) => {
      const active = getActiveTab(s)
      const targetTab =
        active.connectionId === targetConnectionId
          ? active
          : s.tabs.find((tab) => tab.connectionId === targetConnectionId)
      const activeDatabase = database || targetTab?.activeDatabase || ''
      const match = { connectionId: targetConnectionId, database: activeDatabase, code }
      const { focusId, reuseId } = pickFillTarget(s.tabs, targetTab?.id ?? s.activeTabId, match)
      if (focusId) {
        return { activeConnectionId: targetConnectionId, activeTabId: focusId }
      }
      if (reuseId) {
        return {
          activeConnectionId: targetConnectionId,
          activeTabId: reuseId,
          tabs: patchTab(s.tabs, reuseId, {
            connectionId: targetConnectionId,
            code,
            activeDatabase
          })
        }
      }
      const tab = createTab(newTabId(), {
        connectionId: targetConnectionId,
        code,
        activeDatabase
      })
      return {
        activeConnectionId: targetConnectionId,
        tabs: [...s.tabs, tab],
        activeTabId: tab.id
      }
    })
  },

  // ---------------------------------------------------------------- autocomplete
  async sampleFields(connId, db, coll) {
    const key = `${connId}:${db}.${coll}`
    const cached = get().fieldCache[key]
    if (cached) return cached
    try {
      const fields = await window.api.catalog.sampleFields(connId, db, coll)
      set((s) => ({ fieldCache: { ...s.fieldCache, [key]: fields } }))
      return fields
    } catch {
      return []
    }
  },

  getFields(connId, db, coll) {
    return get().fieldCache[`${connId}:${db}.${coll}`] ?? []
  },

  // -------------------------------------------------------------- Schema model
  async loadSchemaModel(target) {
    try {
      return await window.api.schemas.get(target)
    } catch (e) {
      get().notify(
        appNotice('error', tr('notify.loadSchemaFailed', { error: errMessage(e) }), 'document', 'schema:load')
      )
      return null
    }
  },

  async analyzeSchema(target) {
    try {
      const model = await window.api.schemas.analyze(target)
      get().notify(appNotice('success', tr('notify.schemaAnalyzed', { count: model.analysis.sampleSize }), 'document'))
      return model
    } catch (e) {
      get().notify(appNotice('error', tr('notify.analyzeSchemaFailed', { error: errMessage(e) }), 'document'))
      return null
    }
  },

  async saveSchemaDraft(target, draft) {
    try {
      const model = await window.api.schemas.saveDraft(target, draft)
      get().notify(appNotice('success', tr('notify.schemaSaved'), 'document'))
      return model
    } catch (e) {
      get().notify(appNotice('error', tr('notify.saveSchemaFailed', { error: errMessage(e) }), 'document'))
      return null
    }
  },

  async overwriteSchemaDraft(target) {
    try {
      const model = await window.api.schemas.overwriteDraft(target)
      get().notify(appNotice('success', tr('notify.schemaOverwritten'), 'document'))
      return model
    } catch (e) {
      get().notify(appNotice('error', tr('notify.overwriteSchemaFailed', { error: errMessage(e) }), 'document'))
      return null
    }
  },

  // --------------------------------------------------------- document operations
  async readDocument(req) {
    try {
      return await window.api.docs.read(req)
    } catch (e) {
      return { ok: false, found: false, error: errMessage(e) }
    }
  },

  async cancelDocumentRead(taskId) {
    try {
      return await window.api.docs.cancelRead(taskId)
    } catch {
      return false
    }
  },

  async updateDocument(req) {
    try {
      const res = await window.api.docs.update(req)
      if (res.ok) await get().refreshResult()
      else {
        get().notify(
          appNotice(
            'error',
            tr('notify.updateFailed', { error: res.error ?? tr('notify.unknown') }),
            'document',
            `document:${req.connectionId}:${req.database}:${req.collection}:update`
          )
        )
      }
      return res
    } catch (e) {
      const error = errMessage(e)
      get().notify(
        appNotice(
          'error',
          tr('notify.updateFailed', { error }),
          'document',
          `document:${req.connectionId}:${req.database}:${req.collection}:update`
        )
      )
      return { ok: false, error }
    }
  },

  async setDocumentField(req) {
    try {
      const res = await window.api.docs.setField(req)
      if (res.ok) await get().refreshResult()
      else {
        get().notify(
          appNotice(
            'error',
            tr('notify.updateFailed', { error: res.error ?? tr('notify.unknown') }),
            'document',
            `document:${req.connectionId}:${req.database}:${req.collection}:field:${req.path}`
          )
        )
      }
      return res
    } catch (e) {
      const error = errMessage(e)
      get().notify(
        appNotice(
          'error',
          tr('notify.updateFailed', { error }),
          'document',
          `document:${req.connectionId}:${req.database}:${req.collection}:field:${req.path}`
        )
      )
      return { ok: false, error }
    }
  },

  async deleteDocument(req) {
    try {
      const res = await window.api.docs.delete(req)
      if (res.ok) await get().refreshResult()
      else {
        get().notify(
          appNotice(
            'error',
            tr('notify.deleteFailed', { error: res.error ?? tr('notify.unknown') }),
            'document',
            `document:${req.connectionId}:${req.database}:${req.collection}:delete`
          )
        )
      }
      return res
    } catch (e) {
      const error = errMessage(e)
      get().notify(
        appNotice(
          'error',
          tr('notify.deleteFailed', { error }),
          'document',
          `document:${req.connectionId}:${req.database}:${req.collection}:delete`
        )
      )
      return { ok: false, error }
    }
  },

  // ------------------------------------------------------------- import/export
  async chooseExportDirectory() {
    try {
      return await window.api.io.chooseExportDirectory()
    } catch (e) {
      get().notify(
        appNotice(
          'error',
          tr('io.chooseExportDirectoryFailed', { error: errMessage(e) }),
          'io',
          'export:chooseDirectory'
        )
      )
      return null
    }
  },

  async exportCollection(req) {
    try {
      const res = await window.api.io.export(req)
      if (!res.ok && !res.cancelled) {
        get().notify(
          appNotice(
            'error',
            tr('notify.exportFailed', { error: res.error ?? tr('notify.unknown') }),
            'io',
            `export:${req.taskId}`
          )
        )
      } else if (res.warning) {
        get().notify(appNotice('warn', tr('notify.exportWarning'), 'io', `export:${req.taskId}:warning`, res.warning))
      }
      return res
    } catch (e) {
      const error = errMessage(e)
      get().notify(appNotice('error', tr('notify.exportFailed', { error }), 'io', `export:${req.taskId}`))
      return { ok: false, error }
    }
  },

  async cancelExport(taskId) {
    try {
      return await window.api.io.cancelExport(taskId)
    } catch (e) {
      get().notify(appNotice('error', tr('notify.cancelExportFailed'), 'io', `export:${taskId}:cancel`, errMessage(e)))
      return false
    }
  },

  async openExportedFile(taskId) {
    try {
      const error = await window.api.io.openExportedFile(taskId)
      if (error) {
        get().notify(appNotice('error', tr('io.openExportedFileFailed', { error }), 'io', `export:${taskId}:open`))
      }
      return error
    } catch (e) {
      const error = errMessage(e)
      get().notify(appNotice('error', tr('io.openExportedFileFailed', { error }), 'io', `export:${taskId}:open`))
      return error
    }
  },

  async revealExportedFile(taskId) {
    try {
      const error = await window.api.io.revealExportedFile(taskId)
      if (error) {
        get().notify(appNotice('error', tr('io.revealExportedFileFailed', { error }), 'io', `export:${taskId}:reveal`))
      }
      return error
    } catch (e) {
      const error = errMessage(e)
      get().notify(appNotice('error', tr('io.revealExportedFileFailed', { error }), 'io', `export:${taskId}:reveal`))
      return error
    }
  },

  clearExportProgress(taskId) {
    set((state) => {
      const { [taskId]: _removed, ...exportProgress } = state.exportProgress
      return { exportProgress }
    })
  },

  async importCollection(req) {
    try {
      const res = await window.api.io.import(req)
      const key = `import:${req.connectionId}:${req.database}:${req.collection}`
      if (!res.ok && !res.cancelled) {
        get().notify(
          appNotice('error', tr('notify.importFailed', { error: res.error ?? tr('notify.unknown') }), 'io', key)
        )
      } else if (res.warning) {
        get().notify(appNotice('warn', tr('notify.importWarning'), 'io', `${key}:warning`, res.warning))
      }
      return res
    } catch (e) {
      const error = errMessage(e)
      get().notify(
        appNotice(
          'error',
          tr('notify.importFailed', { error }),
          'io',
          `import:${req.connectionId}:${req.database}:${req.collection}`
        )
      )
      return { ok: false, error }
    }
  },

  // -------------------------------------------------------------- preferences
  async checkForUpdates() {
    try {
      const started = await window.api.updates.checkForUpdates()
      if (!started) {
        get().notify(appNotice('warn', tr('notify.updateCheckUnavailable'), 'settings', 'updates:unavailable'))
      }
      return started
    } catch (e) {
      get().notify(
        appNotice('error', tr('notify.updateCheckFailed', { error: errMessage(e) }), 'settings', 'updates:check')
      )
      return false
    }
  },

  async loadUpdateState() {
    subscribeToUpdates()
    try {
      set({ updateState: await window.api.updates.getState() })
    } catch {
      set({ updateState: EMPTY_UPDATE_STATE })
    }
  },

  async setAutomaticUpdateChecks(enabled) {
    try {
      set({ updateState: await window.api.updates.setAutomaticChecks(enabled) })
    } catch (e) {
      get().notify(
        appNotice('error', tr('notify.updateCheckFailed', { error: errMessage(e) }), 'settings', 'updates:automatic')
      )
    }
  },

  async showAvailableUpdate() {
    set((state) => ({
      updateState: { ...state.updateState, availableVersion: null }
    }))
    try {
      const started = await window.api.updates.showAvailableUpdate()
      if (!started) {
        get().notify(appNotice('warn', tr('notify.updateCheckUnavailable'), 'settings', 'updates:unavailable'))
      }
      return started
    } catch (e) {
      get().notify(
        appNotice('error', tr('notify.updateCheckFailed', { error: errMessage(e) }), 'settings', 'updates:show')
      )
      return false
    }
  },

  async openSettings() {
    try {
      await window.api.app.openSettings()
    } catch (e) {
      get().notify(appNotice('error', tr('notify.openSettingsFailed'), 'system', 'settings:open', errMessage(e)))
    }
  },

  async loadSettings() {
    subscribeToSettings()
    try {
      set({ settings: await window.api.settings.get() })
    } catch (e) {
      get().notify(appNotice('warn', tr('notify.loadSettingsFailed'), 'settings', 'settings:load', errMessage(e)))
    }
  },

  async updateSettings(patch) {
    // Optimistic: apply immediately so the UI reflects the toggle, then persist.
    set((s) => ({ settings: { ...s.settings, ...patch } }))
    try {
      const saved = await window.api.settings.update(patch)
      set({ settings: saved })
      getSettingsChannel()?.postMessage(saved)
    } catch (e) {
      get().notify(
        appNotice('error', tr('notify.saveSettingsFailed', { error: errMessage(e) }), 'settings', 'settings:save')
      )
    }
  }
}))

/** Helper to flip a node's loading flag immutably. */
function withLoading(s: AppState, connId: string, nodeId: string, on: boolean): Pick<AppState, 'catalogs'> {
  const c = s.catalogs[connId] ?? emptyCatalog()
  const loading = new Set(c.loading)
  if (on) loading.add(nodeId)
  else loading.delete(nodeId)
  return { catalogs: { ...s.catalogs, [connId]: { ...c, loading } } }
}

// Re-export the empty-catalog factory for selectors that need a fallback.
export { emptyCatalog, statusFor }
