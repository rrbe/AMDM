/**
 * The single source of truth for the renderer.
 *
 * Holds: connections, the active connection, per-connection status,
 * the lazily-loaded catalog tree state, the active database, the shell editor
 * code, per-tab result strips, the chosen result view, and loading/error flags.
 *
 * All backend access happens here via `window.api`; components dispatch actions
 * and read state. Every async action catches rejections and surfaces them as
 * `lastError` (or per-connection status) rather than letting the UI crash.
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
  DocMutateRequest,
  DocMutateResult,
  DocSetFieldRequest,
  DocUpdateRequest,
  ExportRequest,
  HistoryEntry,
  ImportRequest,
  IndexInfo,
  SavedQuery,
  SavedQueryInput,
  ShellResult,
  TestResult,
  ToolStatus,
  UserInfo
} from '@shared/types'
import {
  activeResult,
  appendResult,
  closeResult,
  createTab,
  patchResult,
  patchTab,
  pickActiveAfterClose,
  pickFillTarget,
  type QueryTab,
  type ResultTab
} from '@renderer/lib/tabs'
import i18n from '@renderer/i18n'

/** Shorthand for translating notification / error strings in the store. */
const tr = i18n.t.bind(i18n)

export type { QueryTab, ResultTab }

export type ResultView = 'tree' | 'json' | 'table'

export type NoticeKind = 'success' | 'info' | 'warn'

/** A transient, non-error notification shown as a toast. Errors keep using
    `lastError` (their own channel); this carries success / info / warning. */
export interface Notice {
  kind: NoticeKind
  message: string
  /** Bumped per emit so React remounts the toast and restarts auto-dismiss. */
  key: number
}

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

  // ---- import/export (Phase 3) ----
  /** Resolved mongodump/mongorestore paths (null = not yet checked). */
  toolStatus: ToolStatus | null

  // ---- preferences ----
  settings: AppSettings

  // ---- ui ----
  initializing: boolean
  lastError: string | null
  notice: Notice | null

  // ---- actions: bootstrap ----
  bootstrap(): Promise<void>
  loadConnections(): Promise<void>

  // ---- actions: connection crud ----
  saveConnection(input: ConnectionInput): Promise<ConnectionConfig | null>
  deleteConnection(id: string): Promise<void>
  testConnection(input: ConnectionInput): Promise<TestResult>
  /** Build a connection string from the current form fields ("To URL"). */
  buildConnectionUri(input: ConnectionInput, opts: { includePassword: boolean }): Promise<string | null>
  /** Back up all connections to a JSON file (secrets excluded). */
  exportConnections(): Promise<void>
  /** Restore connections from a JSON backup (adds; secrets must be re-entered). */
  importConnections(): Promise<void>

  // ---- actions: session ----
  connect(id: string): Promise<void>
  disconnect(id: string): Promise<void>
  setActiveConnection(id: string | null): void
  /** Expand/collapse a connection's database subtree in the explorer. */
  toggleConnectionExpanded(id: string): void

  // ---- actions: catalog ----
  toggleNode(connId: string, nodeId: string, kind: NodeKind, payload: NodePayload): Promise<void>
  loadDatabases(connId: string): Promise<void>
  loadCollections(connId: string, db: string): Promise<void>
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
  /** Browse a collection from the explorer: seed `db.<coll>.find({})` into a
      tab of its own — focus an identical browse tab if one is open, refill the
      active tab only while it's pristine, else open a new tab. Never clobbers
      code the user wrote, never auto-runs (ADR-0004 rule 5). */
  browseCollection(db: string, coll: string): void
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
  clearError(): void
  /** Show a transient success/info/warning toast (errors use `lastError`). */
  notify(kind: NoticeKind, message: string): void
  dismissNotice(): void

  // ---- actions: saved queries + history (Phase 2) ----
  loadQueries(): Promise<void>
  saveQuery(input: SavedQueryInput): Promise<SavedQuery | null>
  deleteQuery(id: string): Promise<void>
  loadHistory(): Promise<void>
  clearHistory(): Promise<void>
  /** Load a query/history snippet into the editor (never auto-runs). */
  applyQuery(code: string, database?: string): void

  // ---- actions: autocomplete (Phase 2) ----
  /** Fetch (and cache) sampled field names for a collection. */
  sampleFields(connId: string, db: string, coll: string): Promise<string[]>
  /** Synchronous read of cached field names (for completion sources). */
  getFields(connId: string, db: string, coll: string): string[]

  // ---- actions: document edit/delete (Phase 2) ----
  updateDocument(req: DocUpdateRequest): Promise<DocMutateResult>
  setDocumentField(req: DocSetFieldRequest): Promise<DocMutateResult>
  deleteDocument(req: DocMutateRequest): Promise<DocMutateResult>

  // ---- actions: import/export (Phase 3) ----
  loadToolStatus(): Promise<void>
  exportCollection(req: ExportRequest): Promise<DataOpResult>
  importCollection(req: ImportRequest): Promise<DataOpResult>

  // ---- actions: preferences ----
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

  toolStatus: null,

  settings: DEFAULT_SETTINGS,

  initializing: true,
  lastError: null,
  notice: null,

  // --------------------------------------------------------------------- boot
  async bootstrap() {
    set({ initializing: true })
    await Promise.all([
      get().loadConnections(),
      get().loadQueries(),
      get().loadHistory(),
      get().loadToolStatus(),
      get().loadSettings()
    ])
    set({ initializing: false })
  },

  async loadConnections() {
    try {
      const connections = await window.api.connections.list()
      set({ connections })
    } catch (e) {
      set({ lastError: tr('notify.loadConnectionsFailed', { error: errMessage(e) }) })
    }
  },

  // ----------------------------------------------------------------- conn crud
  async saveConnection(input) {
    try {
      const saved = await window.api.connections.save(input)
      await get().loadConnections()
      return saved
    } catch (e) {
      set({ lastError: tr('notify.saveConnectionFailed', { error: errMessage(e) }) })
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
        return {
          catalogs,
          statuses,
          expandedConnections,
          activeConnectionId: s.activeConnectionId === id ? null : s.activeConnectionId
        }
      })
      await get().loadConnections()
    } catch (e) {
      set({ lastError: tr('notify.deleteConnectionFailed', { error: errMessage(e) }) })
    }
  },

  async testConnection(input) {
    try {
      return await window.api.connections.test(input)
    } catch (e) {
      return { ok: false, error: errMessage(e) }
    }
  },

  async buildConnectionUri(input, opts) {
    try {
      return await window.api.connections.buildUri(input, opts)
    } catch (e) {
      set({ lastError: tr('notify.buildUriFailed', { error: errMessage(e) }) })
      return null
    }
  },

  async exportConnections() {
    try {
      const res = await window.api.connections.export()
      if (res.ok) get().notify('success', tr('notify.exportConnectionsSuccess', { count: res.count ?? 0 }))
      else if (!res.cancelled)
        set({ lastError: tr('notify.exportConnectionsFailed', { error: res.error ?? tr('notify.unknown') }) })
    } catch (e) {
      set({ lastError: tr('notify.exportConnectionsFailed', { error: errMessage(e) }) })
    }
  },

  async importConnections() {
    try {
      const res = await window.api.connections.import()
      if (res.ok) {
        await get().loadConnections()
        get().notify(
          'success',
          tr('notify.importConnectionsSuccess', {
            count: res.count ?? 0,
            warning: res.warning ?? tr('notify.reenterPasswords')
          })
        )
      } else if (!res.cancelled) {
        set({ lastError: tr('notify.importConnectionsFailed', { error: res.error ?? tr('notify.unknown') }) })
      }
    } catch (e) {
      set({ lastError: tr('notify.importConnectionsFailed', { error: errMessage(e) }) })
    }
  },

  // ------------------------------------------------------------------- session
  async connect(id) {
    set((s) => ({
      statuses: { ...s.statuses, [id]: { id, state: 'connecting' } }
    }))
    try {
      const status = await window.api.session.connect(id)
      set((s) => {
        // Auto-expand the connection in the explorer so its databases appear.
        const expandedConnections = new Set(s.expandedConnections)
        if (status.state === 'connected') expandedConnections.add(id)
        return {
          statuses: { ...s.statuses, [id]: status },
          activeConnectionId: id,
          catalogs: { ...s.catalogs, [id]: s.catalogs[id] ?? emptyCatalog() },
          expandedConnections
        }
      })
      if (status.state === 'connected') {
        // Default the active tab's database to the connection's preferred db,
        // unless that tab already has one chosen (don't clobber an explicit pick).
        const conn = get().connections.find((c) => c.id === id)
        const db = conn?.defaultDatabase
        if (db && get().activeConnectionId === id) {
          set((s) =>
            getActiveTab(s).activeDatabase
              ? {}
              : { tabs: patchTab(s.tabs, s.activeTabId, { activeDatabase: db }) }
          )
        }
        await get().loadDatabases(id)
      }
    } catch (e) {
      set((s) => ({
        statuses: { ...s.statuses, [id]: { id, state: 'error', error: errMessage(e) } }
      }))
    }
  },

  async disconnect(id) {
    try {
      await window.api.session.disconnect(id)
    } catch (e) {
      set({ lastError: tr('notify.disconnectFailed', { error: errMessage(e) }) })
    } finally {
      // Dispose catalog cache for this connection (ADR-0004 rule 6).
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
    }
  },

  setActiveConnection(id) {
    set({ activeConnectionId: id })
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
      // No-op: collection children (Indexes/Users) are static folders;
      // their contents load when those folders expand.
    } else if (kind === 'indexes' && payload.db && payload.coll) {
      const key = `${payload.db}/${payload.coll}`
      if (get().catalogs[connId]?.indexes[key] === undefined) {
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
      set({ lastError: tr('notify.loadDatabasesFailed', { error: errMessage(e) }) })
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
      set({ lastError: tr('notify.loadCollectionsFailed', { db, error: errMessage(e) }) })
    } finally {
      set((s) => withLoading(s, connId, nodeId, false))
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
      set({ lastError: tr('notify.loadIndexesFailed', { key, error: errMessage(e) }) })
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
      set({ lastError: tr('notify.loadUsersFailed', { db, error: errMessage(e) }) })
    } finally {
      set((s) => withLoading(s, connId, nodeId, false))
    }
  },

  // ---------------------------------------------------------------------- tabs
  newTab() {
    const tab = createTab(newTabId())
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }))
  },

  setActiveTab(id) {
    set({ activeTabId: id })
  },

  closeTab(id) {
    const closing = get().tabs.find((t) => t.id === id)
    // Free a server-side run the closed tab may have had in flight.
    if (closing?.runningExecId) void window.api.shell.abort(closing.runningExecId).catch(() => {})
    set((s) => {
      const remaining = s.tabs.filter((t) => t.id !== id)
      if (remaining.length === 0) {
        const fresh = createTab(newTabId())
        return { tabs: [fresh], activeTabId: fresh.id }
      }
      const nextActive = pickActiveAfterClose(s.tabs, s.activeTabId, id) ?? remaining[0].id
      return { tabs: remaining, activeTabId: nextActive }
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
  // surfaces as `lastError` like any other failure rather than throwing into UI.
  async formatCode() {
    const tab = getActiveTab(get())
    const code = tab.code
    if (!code.trim()) return
    try {
      const { formatJs } = await import('@renderer/lib/formatJs')
      const formatted = await formatJs(code)
      if (formatted !== code) set((s) => ({ tabs: patchTab(s.tabs, tab.id, { code: formatted }) }))
    } catch (e) {
      set({ lastError: tr('notify.formatFailed', { error: errMessage(e) }) })
    }
  },

  setActiveDatabase(db) {
    set((s) => ({ tabs: patchTab(s.tabs, s.activeTabId, { activeDatabase: db }) }))
  },

  setResultView(view) {
    set({ resultView: view })
  },

  browseCollection(db, coll) {
    // ADR-0004 rule 5: never auto-run. We only seed the editor — and only into
    // a pristine tab, so browsing the catalog can't overwrite user code.
    const seed = `db.${coll}.find({})`
    set((s) => {
      const { focusId, reuseId } = pickFillTarget(s.tabs, s.activeTabId, {
        database: db,
        code: seed
      })
      if (focusId) return { activeTabId: focusId }
      if (reuseId) return { tabs: patchTab(s.tabs, reuseId, { activeDatabase: db, code: seed }) }
      const tab = createTab(newTabId(), { activeDatabase: db, code: seed })
      return { tabs: [...s.tabs, tab], activeTabId: tab.id }
    })
  },

  async runShell(codeOverride) {
    const { activeConnectionId } = get()
    const tab = getActiveTab(get())
    const tabId = tab.id
    const code = codeOverride ?? tab.code
    if (!activeConnectionId) {
      set({ lastError: tr('notify.noActiveConnection') })
      return
    }
    if (!code.trim()) return
    const database = tab.activeDatabase || 'test'
    const limit = get().settings.queryLimit
    const execId = newExecId()
    set((s) => ({
      tabs: patchTab(s.tabs, tabId, { running: true, runningExecId: execId }),
      lastError: null
    }))
    const query = { connectionId: activeConnectionId, database, code }
    try {
      // A fresh run always starts at page 0 and lands in a NEW result tab, so
      // earlier results stay around for side-by-side comparison.
      const result = await window.api.shell.execute({ ...query, limit, skip: 0, execId })
      set((s) => patchTabResults(s, tabId, (t) => appendResult(t, newResultId(), result, query)))
    } catch (e) {
      set((s) =>
        patchTabResults(s, tabId, (t) =>
          appendResult(t, newResultId(), { kind: 'error', error: errMessage(e), errorName: 'IPCError' }, query)
        )
      )
    } finally {
      set((s) => ({ tabs: patchTab(s.tabs, tabId, { running: false, runningExecId: null }) }))
    }
    void get().loadHistory()
  },

  async stopShell() {
    const execId = getActiveTab(get()).runningExecId
    if (!execId) return
    // Best-effort: the run's own `finally` clears the spinner even if abort
    // races past it (the run already finished).
    try {
      await window.api.shell.abort(execId)
    } catch {
      /* ignore — nothing actionable if the abort call itself fails */
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
    const limit = get().settings.queryLimit
    const execId = newExecId()
    set((s) => ({
      tabs: patchTab(s.tabs, tabId, { running: true, runningExecId: execId }),
      lastError: null
    }))
    try {
      const result = await window.api.shell.execute({ ...query, limit, skip, execId })
      set((s) => patchTabResults(s, tabId, (t) => patchResult(t, resultId, { result, skip })))
    } catch (e) {
      set((s) =>
        patchTabResults(s, tabId, (t) =>
          patchResult(t, resultId, { result: { kind: 'error', error: errMessage(e), errorName: 'IPCError' } })
        )
      )
    } finally {
      set((s) => ({ tabs: patchTab(s.tabs, tabId, { running: false, runningExecId: null }) }))
    }
  },

  async setQueryLimit(n) {
    const limit = Math.min(1000, Math.max(1, Math.floor(n) || 1))
    await get().updateSettings({ queryLimit: limit })
    // Re-run the focused result's query from the first page with the new size.
    if (getActiveResult(get())?.query) await get().loadPage(0)
  },

  async runExplain() {
    const { activeConnectionId } = get()
    const tab = getActiveTab(get())
    const tabId = tab.id
    const code = tab.code
    if (!activeConnectionId) {
      set({ lastError: tr('notify.noActiveConnection') })
      return
    }
    if (!code.trim()) return
    const database = tab.activeDatabase || 'test'
    const execId = newExecId()
    set((s) => ({
      tabs: patchTab(s.tabs, tabId, { running: true, runningExecId: execId }),
      lastError: null
    }))
    const query = { connectionId: activeConnectionId, database, code }
    try {
      const result = await window.api.shell.execute({ ...query, explain: true, execId })
      set((s) => patchTabResults(s, tabId, (t) => appendResult(t, newResultId(), result, query)))
    } catch (e) {
      set((s) =>
        patchTabResults(s, tabId, (t) =>
          appendResult(t, newResultId(), { kind: 'error', error: errMessage(e), errorName: 'IPCError' }, query)
        )
      )
    } finally {
      set((s) => ({ tabs: patchTab(s.tabs, tabId, { running: false, runningExecId: null }) }))
    }
    void get().loadHistory()
  },

  async refreshResult() {
    const tab = getActiveTab(get())
    const tabId = tab.id
    const rt = activeResult(tab)
    if (!rt?.query) return
    const resultId = rt.id
    try {
      // Refresh the focused result tab in place — keep its page offset and size.
      const result = await window.api.shell.execute({
        ...rt.query,
        limit: get().settings.queryLimit,
        skip: rt.skip
      })
      set((s) => patchTabResults(s, tabId, (t) => patchResult(t, resultId, { result })))
    } catch (e) {
      set({ lastError: tr('notify.refreshFailed', { error: errMessage(e) }) })
    }
  },

  clearError() {
    set({ lastError: null })
  },

  notify(kind, message) {
    set({ notice: { kind, message, key: Date.now() } })
  },

  dismissNotice() {
    set({ notice: null })
  },

  // ----------------------------------------------------- saved queries + history
  async loadQueries() {
    try {
      set({ savedQueries: await window.api.queries.list() })
    } catch (e) {
      set({ lastError: tr('notify.loadSavedQueriesFailed', { error: errMessage(e) }) })
    }
  },

  async saveQuery(input) {
    try {
      const saved = await window.api.queries.save(input)
      await get().loadQueries()
      get().notify('success', tr('notify.saveQuerySuccess', { name: saved.name }))
      return saved
    } catch (e) {
      set({ lastError: tr('notify.saveQueryFailed', { error: errMessage(e) }) })
      return null
    }
  },

  async deleteQuery(id) {
    try {
      await window.api.queries.delete(id)
      await get().loadQueries()
    } catch (e) {
      set({ lastError: tr('notify.deleteQueryFailed', { error: errMessage(e) }) })
    }
  },

  async loadHistory() {
    try {
      set({ history: await window.api.history.list() })
    } catch (e) {
      set({ lastError: tr('notify.loadHistoryFailed', { error: errMessage(e) }) })
    }
  },

  async clearHistory() {
    try {
      await window.api.history.clear()
      set({ history: [] })
    } catch (e) {
      set({ lastError: tr('notify.clearHistoryFailed', { error: errMessage(e) }) })
    }
  },

  applyQuery(code, database) {
    // Never auto-run (ADR-0004 rule 5). Loads land like browse seeds: refill
    // the active tab while it's pristine, else open a tab of their own —
    // loading a query must not clobber code the user wrote.
    set((s) => {
      const activeDatabase = database || getActiveTab(s).activeDatabase
      const { reuseId } = pickFillTarget(s.tabs, s.activeTabId)
      if (reuseId) return { tabs: patchTab(s.tabs, reuseId, { code, activeDatabase }) }
      const tab = createTab(newTabId(), { code, activeDatabase })
      return { tabs: [...s.tabs, tab], activeTabId: tab.id }
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

  // ----------------------------------------------------------- document mutations
  async updateDocument(req) {
    try {
      const res = await window.api.docs.update(req)
      if (res.ok) await get().refreshResult()
      else set({ lastError: tr('notify.updateFailed', { error: res.error ?? tr('notify.unknown') }) })
      return res
    } catch (e) {
      const error = errMessage(e)
      set({ lastError: tr('notify.updateFailed', { error }) })
      return { ok: false, error }
    }
  },

  async setDocumentField(req) {
    try {
      const res = await window.api.docs.setField(req)
      if (res.ok) await get().refreshResult()
      else set({ lastError: tr('notify.updateFailed', { error: res.error ?? tr('notify.unknown') }) })
      return res
    } catch (e) {
      const error = errMessage(e)
      set({ lastError: tr('notify.updateFailed', { error }) })
      return { ok: false, error }
    }
  },

  async deleteDocument(req) {
    try {
      const res = await window.api.docs.delete(req)
      if (res.ok) await get().refreshResult()
      else set({ lastError: tr('notify.deleteFailed', { error: res.error ?? tr('notify.unknown') }) })
      return res
    } catch (e) {
      const error = errMessage(e)
      set({ lastError: tr('notify.deleteFailed', { error }) })
      return { ok: false, error }
    }
  },

  // ------------------------------------------------------------- import/export
  async loadToolStatus() {
    try {
      set({ toolStatus: await window.api.io.toolStatus() })
    } catch {
      set({ toolStatus: {} })
    }
  },

  async exportCollection(req) {
    try {
      const res = await window.api.io.export(req)
      if (!res.ok && !res.cancelled) set({ lastError: tr('notify.exportFailed', { error: res.error ?? tr('notify.unknown') }) })
      return res
    } catch (e) {
      const error = errMessage(e)
      set({ lastError: tr('notify.exportFailed', { error }) })
      return { ok: false, error }
    }
  },

  async importCollection(req) {
    try {
      const res = await window.api.io.import(req)
      if (!res.ok && !res.cancelled) set({ lastError: tr('notify.importFailed', { error: res.error ?? tr('notify.unknown') }) })
      return res
    } catch (e) {
      const error = errMessage(e)
      set({ lastError: tr('notify.importFailed', { error }) })
      return { ok: false, error }
    }
  },

  // -------------------------------------------------------------- preferences
  async loadSettings() {
    try {
      set({ settings: await window.api.settings.get() })
    } catch {
      /* keep defaults */
    }
  },

  async updateSettings(patch) {
    // Optimistic: apply immediately so the UI reflects the toggle, then persist.
    set((s) => ({ settings: { ...s.settings, ...patch } }))
    try {
      const saved = await window.api.settings.update(patch)
      set({ settings: saved })
    } catch (e) {
      set({ lastError: tr('notify.saveSettingsFailed', { error: errMessage(e) }) })
    }
  }
}))

/** Helper to flip a node's loading flag immutably. */
function withLoading(
  s: AppState,
  connId: string,
  nodeId: string,
  on: boolean
): Pick<AppState, 'catalogs'> {
  const c = s.catalogs[connId] ?? emptyCatalog()
  const loading = new Set(c.loading)
  if (on) loading.add(nodeId)
  else loading.delete(nodeId)
  return { catalogs: { ...s.catalogs, [connId]: { ...c, loading } } }
}

// Re-export the empty-catalog factory for selectors that need a fallback.
export { emptyCatalog, statusFor }
