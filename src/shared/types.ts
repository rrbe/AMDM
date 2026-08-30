/**
 * Shared types — the contract between the Electron main process and the React
 * renderer. Both sides import from here so the IPC boundary stays type-safe.
 *
 * Secrets (passwords, passphrases) are NEVER persisted in plaintext: the main
 * process encrypts them with Electron `safeStorage` (macOS Keychain-backed).
 * They cross the IPC boundary only when the user explicitly enters/saves them.
 */

// ---------------------------------------------------------------------------
// Connection configuration
// ---------------------------------------------------------------------------

export type ScramMechanism = 'DEFAULT' | 'SCRAM-SHA-1' | 'SCRAM-SHA-256'

export interface AuthConfig {
  /** 'none' = no auth; 'scram' = username/password (SCRAM-SHA-1/256). */
  type: 'none' | 'scram'
  username?: string
  /** authSource db, defaults to 'admin'. */
  authSource?: string
  mechanism?: ScramMechanism
}

export type SshAuthMethod = 'password' | 'privateKey'

/**
 * A single SSH hop in front of the target (a bastion / jump host, i.e. ProxyJump).
 * Authenticates via a private key file only; a passphrase for that key is
 * carried out-of-band as `ConnectionInput.jumpSshPassphrase` (encrypted at rest,
 * like the other secrets) rather than on this config object.
 */
export interface SshHopConfig {
  host?: string
  port?: number // default 22
  username?: string
  /** Always 'privateKey' — a jump hop never uses password auth (a bastion should be key-secured). */
  authMethod?: 'privateKey'
  privateKeyPath?: string
  /** Pinned SHA256 host-key fingerprint (hex), learned via TOFU. Not a secret. */
  pinnedHostKey?: string
}

export interface SshConfig {
  enabled: boolean
  host?: string
  port?: number // default 22
  username?: string
  authMethod?: SshAuthMethod
  /** Path to a private key file on disk (we read it at connect time). */
  privateKeyPath?: string
  /**
   * Pinned SHA256 host-key fingerprint (hex). Learned on first connect (TOFU)
   * and verified thereafter; a mismatch blocks the connection. Not a secret.
   */
  pinnedHostKey?: string
  /** Optional single bastion in front of the target (reach the target through it). */
  jump?: SshHopConfig
}

export interface TlsConfig {
  enabled: boolean
  /** Accept self-signed / mismatched certs (insecure; opt-in). */
  allowInvalidCertificates?: boolean
  /** Path to a CA bundle (.pem). */
  caFile?: string
  /** Path to a combined client cert+key (.pem). */
  certificateKeyFile?: string
}

/**
 * A persisted connection. NOTE: this is the *sanitized* shape returned to the
 * renderer — plaintext secrets are stripped and replaced by `has*` booleans.
 */
export interface ConnectionConfig {
  id: string
  name: string
  /** Optional preset color tag (hex, e.g. "#3b82f6") shown in the sidebar. */
  color?: string

  /** When true, build a `mongodb+srv://` URI from `host` (Atlas). */
  useSrv: boolean
  /** SRV host, or comma-separated non-SRV seed list (`host[:port],…`). */
  host: string
  /** Legacy single-host port; new non-SRV connections keep ports in `host`. */
  port?: number // default 27017 (ignored when useSrv or host already contains ports)
  replicaSet?: string
  /** Optional default database to open the shell against. */
  defaultDatabase?: string
  /** Extra connection-string options, e.g. { readPreference: 'secondaryPreferred' }. */
  options?: Record<string, string>

  auth: AuthConfig
  ssh: SshConfig
  tls: TlsConfig

  // --- sanitized secret indicators (true if a secret is stored) ---
  hasPassword?: boolean
  hasSshPassword?: boolean
  hasSshPassphrase?: boolean
  hasJumpSshPassphrase?: boolean

  createdAt: number
  updatedAt: number
}

/**
 * Payload for creating/updating a connection. Carries plaintext secrets that
 * the main process will encrypt. Leave a secret field `undefined` on update to
 * keep the previously stored value; pass empty string to clear it.
 */
export interface ConnectionInput extends Omit<
  ConnectionConfig,
  'hasPassword' | 'hasSshPassword' | 'hasSshPassphrase' | 'hasJumpSshPassphrase' | 'createdAt' | 'updatedAt'
> {
  password?: string
  sshPassword?: string
  sshPassphrase?: string
  /** Passphrase for the jump host's private key. */
  jumpSshPassphrase?: string
}

/** Options for the native "open file" picker exposed over IPC. */
export interface OpenFileOptions {
  title?: string
  defaultPath?: string
  filters?: { name: string; extensions: string[] }[]
}

/** Which hop a connectivity check targets: the SSH/target host, or the jump host. */
export type DiagnoseScope = 'ssh' | 'jump'

/** One step of an SSH-tunnel connectivity diagnosis. `key` maps to a localized label. */
export interface DiagnoseStage {
  /** Stable stage id: tcp-jump | ssh-jump | tcp-target | ssh-target | tcp-ssh | ssh | config */
  key: string
  /** The host:port this step checks (empty for a config error). */
  target: string
  status: 'ok' | 'fail' | 'skip'
  /** Elapsed milliseconds (omitted for skipped steps). */
  ms?: number
  /** Failure reason (classified, human-readable) when status is 'fail'. */
  detail?: string
}

// ---------------------------------------------------------------------------
// Live session / catalog
// ---------------------------------------------------------------------------

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

/** Stable failure categories carried across IPC; UI copy must not parse driver messages. */
export type FailureKind =
  'timeout' | 'network' | 'dns' | 'auth' | 'hostkey' | 'cancelled' | 'execution' | 'ipc' | 'unknown'

export interface ConnectionStatus {
  id: string
  state: ConnectionState
  /** Populated when state === 'error'. */
  error?: string
  failureKind?: FailureKind
  /** Topology hint, e.g. "ReplicaSetWithPrimary" / "Single". */
  topology?: string
  /** Server version string, when known. */
  serverVersion?: string
}

export interface TestResult {
  ok: boolean
  error?: string
  failureKind?: FailureKind
  topology?: string
  serverVersion?: string
}

export interface DatabaseInfo {
  name: string
  sizeOnDisk?: number
  empty?: boolean
}

export interface CollectionInfo {
  name: string
  type: 'collection' | 'view' | 'timeseries'
  /** Approximate document count (estimated; cheap). */
  estimatedCount?: number
}

export interface IndexInfo {
  name: string
  /** EJSON-serialized key spec, e.g. { field: 1 }. */
  key: Record<string, unknown>
  unique?: boolean
  sparse?: boolean
  ttlSeconds?: number
}

export interface UserInfo {
  user: string
  db: string
  roles: Array<{ role: string; db: string }>
}

// ---------------------------------------------------------------------------
// Schema analysis / local modeling
// ---------------------------------------------------------------------------

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

/** MongoDB-flavoured JSON Schema kept as plain JSON for IPC + local storage. */
export interface MongoJsonSchema {
  [key: string]: JsonValue
}

export interface SchemaTarget {
  connectionId: string
  database: string
  collection: string
}

/** One observed BSON type within a sampled field. */
export interface SchemaTypeStat {
  name: string
  bsonType: string
  count: number
  probability: number
  /** Nested document fields. */
  fields?: SchemaFieldStat[]
  /** Element types when this type is an array. */
  types?: SchemaTypeStat[]
}

/** Recursive field statistics inferred from the sampled documents. */
export interface SchemaFieldStat {
  name: string
  count: number
  probability: number
  types: SchemaTypeStat[]
}

export interface SchemaAnalysis {
  analyzedAt: number
  /** Actual documents returned by the bounded sample. */
  sampleSize: number
  fields: SchemaFieldStat[]
  generated: MongoJsonSchema
}

/** Persisted local model: observed data and the user's desired schema stay separate. */
export interface SchemaModel {
  target: SchemaTarget
  analysis: SchemaAnalysis
  draft: MongoJsonSchema
  draftUpdatedAt: number
}

// ---------------------------------------------------------------------------
// Shell execution
// ---------------------------------------------------------------------------

export interface ShellRequest {
  connectionId: string
  database: string
  code: string
  /** Default page size applied to bare cursors so results remain bounded. */
  limit?: number
  /** Page offset injected into a `find()` cursor for prev/next paging. Only
      honored when the script's result is a FindCursor (see `pageable`). */
  skip?: number
  /** Run the query under explain('executionStats') instead of fetching docs. */
  explain?: boolean
  /** Default server-side limit for read operations. Explicit query options win. */
  timeoutMS?: number
  /** Opaque per-run id. When present the main process registers an
      AbortController under it so the run can be cancelled via `shell.abort`. */
  execId?: string
}

export type ShellResultKind = 'documents' | 'value' | 'ack' | 'explain' | 'error'

/**
 * One captured shell-output line (print / printjson / console.*). Text lines
 * carry a ready-to-display string; printjson payloads stay EJSON-canonical so
 * the Console view renders them with the same shell-style formatting as the
 * JSON view.
 */
export interface ShellOutputLine {
  kind: 'text' | 'json'
  /** Display string when kind === 'text'. */
  text?: string
  /** EJSON-canonical value when kind === 'json'. */
  data?: unknown
  /** Console channel; 'warn'/'error' tint the line. Defaults to 'log'. */
  level?: 'log' | 'warn' | 'error'
}

export interface ShellResult {
  kind: ShellResultKind
  /**
   * EJSON-canonical serialized payload (plain JSON-cloneable objects, with
   * extended-type markers like {$oid}, {$date}). Renderer interprets these for
   * the Tree/Table/JSON views. For 'documents' this is an array; for 'value'
   * any EJSON value; for 'ack' a write-result summary.
   */
  data?: unknown
  /** Number of docs in `data` when kind === 'documents'. */
  count?: number
  /** True if a default limit was auto-applied to a cursor (more may exist). */
  truncated?: boolean
  /** True when the result is a FindCursor, so prev/next paging (skip) is
      supported. Aggregation cursors and arrays are not pageable. */
  pageable?: boolean
  /** Page offset that produced this result (echoes the request's skip). */
  skip?: number
  /** Target collection parsed from the code (enables doc edit/delete). */
  collection?: string
  /** Server execution time in ms (best-effort). */
  elapsedMs?: number
  /** Populated when kind === 'error'. */
  error?: string
  errorName?: string
  failureKind?: FailureKind
  /** Set by the `use <db>` REPL command — tells the renderer to switch the
      active database for the tab (mongosh-style). */
  useDatabase?: string
  /** Captured print/printjson/console output, in call order (bounded). Present
      for every kind — an error still carries the output produced before it. */
  output?: ShellOutputLine[]
  /** True when output hit the capture cap and further lines were dropped. */
  outputTruncated?: boolean
}

// ---------------------------------------------------------------------------
// Saved queries + execution history (Phase 2)
// ---------------------------------------------------------------------------

export interface SavedQuery {
  id: string
  name: string
  code: string
  /** Optional binding to a connection + database. */
  connectionId?: string
  database?: string
  /** Optional folder name for two-level organization in the sidebar. Empty /
      undefined = ungrouped. */
  folder?: string
  createdAt: number
  updatedAt: number
}

/** Payload for creating/updating a saved query. */
export interface SavedQueryInput {
  id?: string
  name: string
  code: string
  connectionId?: string
  database?: string
  folder?: string
}

export interface HistoryEntry {
  id: string
  code: string
  connectionId: string
  database: string
  ranAt: number
  ok: boolean
  /** Short summary, e.g. "12 docs · 8ms" or an error name. */
  summary?: string
}

// ---------------------------------------------------------------------------
// Document edit / delete (Phase 2)
// ---------------------------------------------------------------------------

export interface DocMutateRequest {
  connectionId: string
  database: string
  collection: string
  /** EJSON-serialized _id value, exactly as it arrived in the result. */
  id: unknown
}

export interface DocUpdateRequest extends DocMutateRequest {
  /** Full replacement document as an EJSON string (edited by the user). */
  documentEjson: string
}

export interface DocSetFieldRequest extends DocMutateRequest {
  /** Dot-path of the field to set (e.g. "address.city", "tags.0"). */
  path: string
  /** New value as an EJSON string (parsed back to BSON on the main side). */
  valueEjson: string
}

export interface DocReadRequest extends DocMutateRequest {
  /** Opaque owner-scoped id used to cancel this one refresh operation. */
  taskId: string
}

export interface DocReadResult {
  ok: boolean
  found: boolean
  /** EJSON-canonical document when found. */
  document?: unknown
  error?: string
}

export interface DocMutateResult {
  ok: boolean
  error?: string
  matched?: number
  modified?: number
  deleted?: number
}

// ---------------------------------------------------------------------------
// Import / export (Phase 3)
// ---------------------------------------------------------------------------

export type TabularExportFormat = 'csv' | 'tsv' | 'xlsx'
export type JsonExportFormat = 'json' | 'jsonl'
export type JsonEncoding = 'plain' | 'relaxed' | 'canonical'
export type ResultExportFormat = JsonExportFormat | TabularExportFormat | 'bson'
export type ExportFormat = ResultExportFormat
export type TabularDelimiter = ',' | ';' | ' ' | '\t' | '/' | '-' | '.'

/** Owner-scoped directory capability returned by the native directory picker. */
export interface ExportDirectorySelection {
  selectionId: string
  path: string
}

export interface ExportDestination {
  directorySelectionId: string
  /** Base file name entered in the export form; the format controls the extension. */
  fileName: string
}

interface ExportOptions {
  /** Opaque id used for progress events and cancellation. */
  taskId: string
  format: ExportFormat
  /** Tabular formats: include the derived field-name row. */
  includeHeader?: boolean
  /** CSV/TSV: prepend a UTF-8 BOM for spreadsheet compatibility. */
  utf8Bom?: boolean
  /** CSV/TSV line separator. */
  lineEnding?: 'lf' | 'crlf'
  /** CSV/TSV field separator. */
  delimiter?: TabularDelimiter
  /** XLSX worksheet name; sanitized again in main before writing. */
  worksheetName?: string
  /** JSON/JSONL: how canonical EJSON values are represented in the output. */
  jsonEncoding?: JsonEncoding
  /** Keep exported columns consistent with the Table view. */
  fieldSort?: CollectionSort
}

export interface CollectionExportRequest extends ExportOptions {
  source: 'collection'
  connectionId: string
  database: string
  collection: string
  /** Optional EJSON filter string for native formats (default {} = all). */
  query?: string
  /** Optional cap on documents exported. */
  limit?: number
  /** bson: gzip the output (writes a `.bson.gz`). */
  gzip?: boolean
}

export interface ResultExportRequest extends ExportOptions {
  source: 'result'
  format: ResultExportFormat
  /** EJSON-canonical, structured-cloneable documents already loaded by Renderer. */
  documents: unknown[]
}

export type ExportRequest = CollectionExportRequest | ResultExportRequest
export type ExportFileRequest = ExportRequest & { destination: ExportDestination }

export interface ImportRequest {
  connectionId: string
  database: string
  collection: string
}

export type ExportProgressPhase = 'scanning' | 'writing' | 'finalizing'

export interface ExportProgress {
  taskId: string
  phase: ExportProgressPhase
  processed: number
  /** Present for an in-memory result source; collection totals are not queried implicitly. */
  total?: number
}

export interface DataOpResult {
  ok: boolean
  error?: string
  /** Documents exported/imported. */
  count?: number
  /** Resolved file path (export target / import source). */
  filePath?: string
  /** Non-fatal note (e.g. some documents skipped on duplicate _id). */
  warning?: string
  /** True when the user cancelled the file dialog. */
  cancelled?: boolean
}

// ---------------------------------------------------------------------------
// App settings / preferences (persisted to settings.json)
// ---------------------------------------------------------------------------

/** How databases/collections are ordered in the catalog tree. */
export type CollectionSort = 'natural' | 'alpha'

/**
 * UI color theme. 'system' (default) follows the OS appearance and reacts to
 * OS changes live; 'light'/'dark' pin the Stone light / Stone Night palettes.
 */
export type ThemeMode = 'light' | 'dark' | 'system'

export interface EditorColorPalette {
  background: string
  foreground: string
  keyword: string
  string: string
  number: string
  type: string
  comment: string
}

export interface EditorColorScheme {
  id: string
  name: string
  light: EditorColorPalette
  dark: EditorColorPalette
}

export const PINE_COLOR_SCHEME_ID = 'pine'

/**
 * UI language. 'system' (default) resolves to the OS/app locale at startup
 * (zh-CN / zh-TW / en), falling back to English; the others pin a locale.
 */
export type Language = 'system' | 'en' | 'zh-CN' | 'zh-TW'

export type KeyboardShortcutId = 'newConnection' | 'newQuery' | 'contextualTabs' | 'resultView' | 'openSettings'

export interface AppSettings {
  /** User-defined ordering of connection ids; missing/new ids append naturally. */
  connectionOrder: string[]
  /** Absolute directory opened first by the native export-directory picker. */
  defaultExportDirectory: string
  /** 'natural' = server order; 'alpha' = A→Z by name. */
  collectionSort: CollectionSort
  /** 'system' = follow OS (default); 'light' = Stone; 'dark' = Stone Night. */
  theme: ThemeMode
  /** UI language. 'system' (default) follows the OS/app locale. */
  language: Language
  /** Explorer sidebar width in px (drag-resizable; clamped at the UI). */
  sidebarWidth: number
  /** Shell editor pane height in px (drag-resizable; clamped at the UI). */
  editorHeight: number
  /** Page size for query results — how many docs a cursor fetches per page
      (bounded; never the whole collection). */
  queryLimit: number
  /** Default MongoDB maxTimeMS for read operations; 0 disables the limit. */
  queryTimeoutMS: number
  /** Maximum number of executed queries retained in History. */
  historyLimit: number
  /** Shell editor font size in px (CodeMirror; ⌘+/⌘−/⌘0 or right-click menu). */
  editorFontSize: number
  /** Data result views font size in px (Tree / JSON / Table / Console). */
  dataFontSize: number
  /** Soft-wrap long lines in the shell editor instead of scrolling sideways. */
  editorWordWrap: boolean
  /** Indent width (spaces) for Tab / auto-indent in the shell editor. */
  editorTabSize: number
  /** Active built-in or user-defined editor/result color scheme id. */
  activeEditorColorSchemeId: string
  /** User-defined schemes; the built-in Pine scheme stays in code. */
  editorColorSchemes: EditorColorScheme[]
  /** Remembered "To URL" choice: inline the real password (vs `<password>`
      placeholder). Defaults off; persisted so the user's last pick sticks. */
  exportIncludeRealPassword: boolean
  /** Latest scheduled update reminder the user opened; later versions still notify. */
  acknowledgedUpdateVersion: string | null
  /** App-wide navigation/new-item shortcuts; editor-local key bindings are separate. */
  keyboardShortcutsEnabled: boolean
  /** Individually cleared app shortcut ids. */
  disabledKeyboardShortcuts: KeyboardShortcutId[]
}

/** Runtime state of the macOS Sparkle updater. */
export interface UpdateState {
  /** False outside a packaged macOS build. */
  available: boolean
  /** Sparkle's persisted scheduled-check preference. */
  automaticallyChecksForUpdates: boolean
  /** Version shown by the gentle reminder, or null when there is no reminder. */
  availableVersion: string | null
}

export const QUERY_LIMITS = [5, 10, 20, 50, 100, 200, 500, 1000, 2000] as const
export const QUERY_TIMEOUTS_MS = [0, 10_000, 30_000, 60_000, 300_000] as const
export const HISTORY_LIMITS = [50, 100, 200, 500, 1000] as const

export const DEFAULT_SETTINGS: AppSettings = {
  connectionOrder: [],
  defaultExportDirectory: '',
  collectionSort: 'alpha',
  theme: 'system',
  language: 'system',
  sidebarWidth: 270,
  editorHeight: 142,
  queryLimit: 50,
  queryTimeoutMS: 30_000,
  historyLimit: 200,
  editorFontSize: 13,
  dataFontSize: 13,
  editorWordWrap: false,
  editorTabSize: 2,
  activeEditorColorSchemeId: PINE_COLOR_SCHEME_ID,
  editorColorSchemes: [],
  exportIncludeRealPassword: false,
  acknowledgedUpdateVersion: null,
  keyboardShortcutsEnabled: true,
  disabledKeyboardShortcuts: []
}
