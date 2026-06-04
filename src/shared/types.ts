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

export interface SshConfig {
  enabled: boolean
  host?: string
  port?: number // default 22
  username?: string
  authMethod?: SshAuthMethod
  /** Path to a private key file on disk (we read it at connect time). */
  privateKeyPath?: string
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
  /** Host (or SRV host). For non-SRV, paired with `port`. */
  host: string
  port?: number // default 27017 (ignored when useSrv)
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

  createdAt: number
  updatedAt: number
}

/**
 * Payload for creating/updating a connection. Carries plaintext secrets that
 * the main process will encrypt. Leave a secret field `undefined` on update to
 * keep the previously stored value; pass empty string to clear it.
 */
export interface ConnectionInput
  extends Omit<ConnectionConfig, 'hasPassword' | 'hasSshPassword' | 'hasSshPassphrase' | 'createdAt' | 'updatedAt'> {
  password?: string
  sshPassword?: string
  sshPassphrase?: string
}

// ---------------------------------------------------------------------------
// Live session / catalog
// ---------------------------------------------------------------------------

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface ConnectionStatus {
  id: string
  state: ConnectionState
  /** Populated when state === 'error'. */
  error?: string
  /** Topology hint, e.g. "ReplicaSetWithPrimary" / "Single". */
  topology?: string
  /** Server version string, when known. */
  serverVersion?: string
}

export interface TestResult {
  ok: boolean
  error?: string
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
// Shell execution
// ---------------------------------------------------------------------------

export interface ShellRequest {
  connectionId: string
  database: string
  code: string
  /** Default page size applied to bare cursors (ADR-0004 rule 2). */
  limit?: number
  /** Page offset injected into a `find()` cursor for prev/next paging. Only
      honored when the script's result is a FindCursor (see `pageable`). */
  skip?: number
  /** Run the query under explain('executionStats') instead of fetching docs. */
  explain?: boolean
  /** Opaque per-run id. When present the main process registers an
      AbortController under it so the run can be cancelled via `shell.abort`. */
  execId?: string
}

export type ShellResultKind = 'documents' | 'value' | 'ack' | 'explain' | 'error'

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

export type DataFormat = 'json' | 'csv' | 'xlsx' | 'bson'

export interface ExportRequest {
  connectionId: string
  database: string
  collection: string
  format: DataFormat
  /** Optional EJSON filter string for native formats (default {} = all). */
  query?: string
  /** Optional cap on documents exported. */
  limit?: number
  /** json: true = single array, false = newline-delimited (NDJSON). */
  jsonArray?: boolean
}

export interface ImportRequest {
  connectionId: string
  database: string
  collection: string
  format: DataFormat
}

export interface DataOpResult {
  ok: boolean
  error?: string
  /** Documents exported/imported. */
  count?: number
  /** Resolved file path (export target / import source). */
  filePath?: string
  /** Non-fatal note (e.g. BSON restored to original namespace). */
  warning?: string
  /** True when the user cancelled the file dialog. */
  cancelled?: boolean
}

/** Resolved paths to the official MongoDB Database Tools (undefined = missing). */
export interface ToolStatus {
  mongodump?: string
  mongorestore?: string
}

// ---------------------------------------------------------------------------
// App settings / preferences (persisted to settings.json — see ADR-0006)
// ---------------------------------------------------------------------------

/** How databases/collections are ordered in the catalog tree. */
export type CollectionSort = 'natural' | 'alpha'

/**
 * UI color theme. 'system' (default) follows the OS appearance and reacts to
 * OS changes live; 'light'/'dark' pin the Pine light / Pine Night palettes.
 */
export type ThemeMode = 'light' | 'dark' | 'system'

export interface AppSettings {
  /** 'natural' = server order; 'alpha' = A→Z by name. */
  collectionSort: CollectionSort
  /** 'system' = follow OS (default); 'light' = Pine; 'dark' = Pine Night. */
  theme: ThemeMode
  /** Explorer sidebar width in px (drag-resizable; clamped at the UI). */
  sidebarWidth: number
  /** Shell editor pane height in px (drag-resizable; clamped at the UI). */
  editorHeight: number
  /** Page size for query results — how many docs a cursor fetches per page
      (ADR-0004 rule 2: bounded; never the whole collection). */
  queryLimit: number
  /** Shell editor font size in px (CodeMirror; ⌘+/⌘−/⌘0 or right-click menu). */
  editorFontSize: number
  /** Soft-wrap long lines in the shell editor instead of scrolling sideways. */
  editorWordWrap: boolean
  /** Indent width (spaces) for Tab / auto-indent in the shell editor. */
  editorTabSize: number
}

export const DEFAULT_SETTINGS: AppSettings = {
  collectionSort: 'natural',
  theme: 'system',
  sidebarWidth: 300,
  editorHeight: 160,
  queryLimit: 50,
  editorFontSize: 13,
  editorWordWrap: false,
  editorTabSize: 2
}
