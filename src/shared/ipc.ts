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
  DiagnoseScope,
  DiagnoseStage,
  OpenFileOptions,
  DataOpResult,
  DocMutateRequest,
  DocMutateResult,
  DocSetFieldRequest,
  DocUpdateRequest,
  ExportRequest,
  ExportProgress,
  HistoryEntry,
  ImportRequest,
  IndexInfo,
  MongoJsonSchema,
  SavedQuery,
  SavedQueryInput,
  SchemaModel,
  SchemaTarget,
  ShellRequest,
  ShellResult,
  TestResult,
  UpdateState,
  UserInfo
} from './types'

export const IPC = {
  connectionsList: 'connections:list',
  connectionsSave: 'connections:save',
  connectionsDelete: 'connections:delete',
  connectionsTest: 'connections:test',
  connectionsDiagnose: 'connections:diagnose',
  connectionsBuildUri: 'connections:buildUri',

  sessionConnect: 'session:connect',
  sessionDisconnect: 'session:disconnect',
  sessionStatus: 'session:status',
  sessionStatusChanged: 'session:statusChanged',

  catalogDatabases: 'catalog:databases',
  catalogCollections: 'catalog:collections',
  catalogCollectionCount: 'catalog:collectionCount',
  catalogIndexes: 'catalog:indexes',
  catalogUsers: 'catalog:users',
  catalogSampleFields: 'catalog:sampleFields',

  schemasGet: 'schemas:get',
  schemasAnalyze: 'schemas:analyze',
  schemasSaveDraft: 'schemas:saveDraft',
  schemasOverwriteDraft: 'schemas:overwriteDraft',

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
  ioExportCancel: 'io:exportCancel',
  ioExportProgress: 'io:exportProgress',
  ioImport: 'io:import',

  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',

  appOpenSettings: 'app:openSettings',

  updatesCheck: 'updates:check',
  updatesGetState: 'updates:getState',
  updatesSetAutomaticChecks: 'updates:setAutomaticChecks',
  updatesShowAvailable: 'updates:showAvailable',
  updatesStateChanged: 'updates:stateChanged',

  dialogOpenFile: 'dialog:openFile'
} as const

/** The API shape exposed on `window.api` (see preload). */
export interface Api {
  app: {
    openSettings(): Promise<void>
  }
  connections: {
    list(): Promise<ConnectionConfig[]>
    save(input: ConnectionInput): Promise<ConnectionConfig>
    delete(id: string): Promise<void>
    test(input: ConnectionInput): Promise<TestResult>
    /** Single-hop SSH connectivity check (`scope`: the target host or the jump host). */
    diagnose(input: ConnectionInput, scope: DiagnoseScope): Promise<DiagnoseStage[]>
    /**
     * Build a connection string from the CURRENT form fields ("To URL" export) —
     * works while creating or editing. With `includePassword`, the plaintext
     * password is inlined (from the form if just typed, else — when editing a
     * saved connection not re-typed — decrypted from the store, which renderers
     * never hold); otherwise a readable `<password>` placeholder is used.
    */
    buildUri(input: ConnectionInput, opts: { includePassword: boolean }): Promise<string>
  }
  session: {
    connect(connectionId: string): Promise<ConnectionStatus>
    disconnect(connectionId: string): Promise<void>
    status(connectionId: string): Promise<ConnectionStatus>
    /** Driver topology monitoring reports unexpected disconnects and recovery here. */
    onStatusChanged(listener: (status: ConnectionStatus) => void): () => void
  }
  catalog: {
    databases(connectionId: string): Promise<DatabaseInfo[]>
    collections(connectionId: string, database: string): Promise<CollectionInfo[]>
    collectionCount(connectionId: string, database: string, collection: string): Promise<number>
    indexes(connectionId: string, database: string, collection: string): Promise<IndexInfo[]>
    users(connectionId: string, database: string): Promise<UserInfo[]>
    /** Bounded, cached field-name sampling for autocomplete. */
    sampleFields(connectionId: string, database: string, collection: string): Promise<string[]>
  }
  schemas: {
    get(target: SchemaTarget): Promise<SchemaModel | null>
    /** Re-sample the collection; an existing user draft is preserved. */
    analyze(target: SchemaTarget): Promise<SchemaModel>
    saveDraft(target: SchemaTarget, draft: MongoJsonSchema): Promise<SchemaModel>
    /** Explicitly replace the user draft with the latest generated Schema. */
    overwriteDraft(target: SchemaTarget): Promise<SchemaModel>
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
    /** Export a collection or bounded Renderer result; opens a native save dialog. */
    export(request: ExportRequest): Promise<DataOpResult>
    cancelExport(taskId: string): Promise<boolean>
    onExportProgress(listener: (progress: ExportProgress) => void): () => void
    /** Import into a collection; opens an open dialog for the source file. */
    import(request: ImportRequest): Promise<DataOpResult>
  }
  settings: {
    get(): Promise<AppSettings>
    /** Merge a partial patch and return the full updated settings. */
    update(patch: Partial<AppSettings>): Promise<AppSettings>
  }
  updates: {
    /** Returns false when Sparkle is unavailable in this build. */
    checkForUpdates(): Promise<boolean>
    getState(): Promise<UpdateState>
    setAutomaticChecks(enabled: boolean): Promise<UpdateState>
    /** Acknowledge the current reminder and bring Sparkle's native window forward. */
    showAvailableUpdate(): Promise<boolean>
    onStateChanged(listener: (state: UpdateState) => void): () => void
  }
  dialog: {
    /** Native open-file picker; resolves the chosen absolute path, or null if cancelled. */
    openFile(opts?: OpenFileOptions): Promise<string | null>
  }
}
