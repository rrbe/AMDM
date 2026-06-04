/**
 * IPC channel names + the typed `window.api` surface exposed by the preload
 * bridge. Keep this in sync on both sides — the renderer only ever talks to the
 * main process through this contract.
 */
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
  ShellRequest,
  ShellResult,
  TestResult,
  ToolStatus,
  UserInfo
} from './types'

export const IPC = {
  connectionsList: 'connections:list',
  connectionsSave: 'connections:save',
  connectionsDelete: 'connections:delete',
  connectionsTest: 'connections:test',

  sessionConnect: 'session:connect',
  sessionDisconnect: 'session:disconnect',
  sessionStatus: 'session:status',

  catalogDatabases: 'catalog:databases',
  catalogCollections: 'catalog:collections',
  catalogIndexes: 'catalog:indexes',
  catalogUsers: 'catalog:users',
  catalogSampleFields: 'catalog:sampleFields',

  shellExecute: 'shell:execute',
  shellAbort: 'shell:abort',

  queriesList: 'queries:list',
  queriesSave: 'queries:save',
  queriesDelete: 'queries:delete',

  historyList: 'history:list',
  historyClear: 'history:clear',

  docUpdate: 'doc:update',
  docSetField: 'doc:setField',
  docDelete: 'doc:delete',

  ioExport: 'io:export',
  ioImport: 'io:import',
  ioToolStatus: 'io:toolStatus',

  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update'
} as const

/** The API shape exposed on `window.api` (see preload). */
export interface Api {
  connections: {
    list(): Promise<ConnectionConfig[]>
    save(input: ConnectionInput): Promise<ConnectionConfig>
    delete(id: string): Promise<void>
    test(input: ConnectionInput): Promise<TestResult>
  }
  session: {
    connect(connectionId: string): Promise<ConnectionStatus>
    disconnect(connectionId: string): Promise<void>
    status(connectionId: string): Promise<ConnectionStatus>
  }
  catalog: {
    databases(connectionId: string): Promise<DatabaseInfo[]>
    collections(connectionId: string, database: string): Promise<CollectionInfo[]>
    indexes(connectionId: string, database: string, collection: string): Promise<IndexInfo[]>
    users(connectionId: string, database: string): Promise<UserInfo[]>
    /** Bounded, cached field-name sampling for autocomplete (ADR-0004 rule 4). */
    sampleFields(connectionId: string, database: string, collection: string): Promise<string[]>
  }
  shell: {
    execute(request: ShellRequest): Promise<ShellResult>
    /** Cancel an in-flight run by its `execId`. Resolves true if a matching
        run was found and signalled, false if it had already finished. */
    abort(execId: string): Promise<boolean>
  }
  queries: {
    list(): Promise<SavedQuery[]>
    save(input: SavedQueryInput): Promise<SavedQuery>
    delete(id: string): Promise<void>
  }
  history: {
    list(): Promise<HistoryEntry[]>
    clear(): Promise<void>
  }
  docs: {
    update(request: DocUpdateRequest): Promise<DocMutateResult>
    setField(request: DocSetFieldRequest): Promise<DocMutateResult>
    delete(request: DocMutateRequest): Promise<DocMutateResult>
  }
  io: {
    /** Export a collection; opens a save dialog and returns the chosen path. */
    export(request: ExportRequest): Promise<DataOpResult>
    /** Import into a collection; opens an open dialog for the source file. */
    import(request: ImportRequest): Promise<DataOpResult>
    /** Resolved paths to mongodump/mongorestore (for BSON; undefined if absent). */
    toolStatus(): Promise<ToolStatus>
  }
  settings: {
    get(): Promise<AppSettings>
    /** Merge a partial patch and return the full updated settings. */
    update(patch: Partial<AppSettings>): Promise<AppSettings>
  }
}
