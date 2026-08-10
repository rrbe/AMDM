import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type Api } from '../shared/ipc'

/**
 * Context-isolated bridge. The renderer gets a typed `window.api`; it cannot
 * touch Node or ipcRenderer directly. Every method is a thin invoke wrapper
 * around a channel declared in the shared IPC contract.
 */
const api: Api = {
  connections: {
    list: () => ipcRenderer.invoke(IPC.connectionsList),
    save: (input) => ipcRenderer.invoke(IPC.connectionsSave, input),
    delete: (id) => ipcRenderer.invoke(IPC.connectionsDelete, id),
    test: (input) => ipcRenderer.invoke(IPC.connectionsTest, input),
    diagnose: (input, scope) => ipcRenderer.invoke(IPC.connectionsDiagnose, input, scope),
    buildUri: (input, opts) => ipcRenderer.invoke(IPC.connectionsBuildUri, input, opts)
  },
  session: {
    connect: (connectionId) => ipcRenderer.invoke(IPC.sessionConnect, connectionId),
    disconnect: (connectionId) => ipcRenderer.invoke(IPC.sessionDisconnect, connectionId),
    status: (connectionId) => ipcRenderer.invoke(IPC.sessionStatus, connectionId)
  },
  catalog: {
    databases: (connectionId) => ipcRenderer.invoke(IPC.catalogDatabases, connectionId),
    collections: (connectionId, database) =>
      ipcRenderer.invoke(IPC.catalogCollections, connectionId, database),
    collectionCount: (connectionId, database, collection) =>
      ipcRenderer.invoke(IPC.catalogCollectionCount, connectionId, database, collection),
    indexes: (connectionId, database, collection) =>
      ipcRenderer.invoke(IPC.catalogIndexes, connectionId, database, collection),
    users: (connectionId, database) => ipcRenderer.invoke(IPC.catalogUsers, connectionId, database),
    sampleFields: (connectionId, database, collection) =>
      ipcRenderer.invoke(IPC.catalogSampleFields, connectionId, database, collection)
  },
  schemas: {
    get: (target) => ipcRenderer.invoke(IPC.schemasGet, target),
    analyze: (target) => ipcRenderer.invoke(IPC.schemasAnalyze, target),
    saveDraft: (target, draft) => ipcRenderer.invoke(IPC.schemasSaveDraft, target, draft),
    overwriteDraft: (target) => ipcRenderer.invoke(IPC.schemasOverwriteDraft, target)
  },
  shell: {
    execute: (request) => ipcRenderer.invoke(IPC.shellExecute, request),
    abort: (execId) => ipcRenderer.invoke(IPC.shellAbort, execId)
  },
  queries: {
    list: () => ipcRenderer.invoke(IPC.queriesList),
    save: (input) => ipcRenderer.invoke(IPC.queriesSave, input),
    delete: (id) => ipcRenderer.invoke(IPC.queriesDelete, id)
  },
  history: {
    list: () => ipcRenderer.invoke(IPC.historyList),
    clear: () => ipcRenderer.invoke(IPC.historyClear)
  },
  docs: {
    update: (request) => ipcRenderer.invoke(IPC.docUpdate, request),
    setField: (request) => ipcRenderer.invoke(IPC.docSetField, request),
    delete: (request) => ipcRenderer.invoke(IPC.docDelete, request)
  },
  io: {
    export: (request) => ipcRenderer.invoke(IPC.ioExport, request),
    import: (request) => ipcRenderer.invoke(IPC.ioImport, request)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    update: (patch) => ipcRenderer.invoke(IPC.settingsUpdate, patch)
  },
  updates: {
    checkForUpdates: () => ipcRenderer.invoke(IPC.updatesCheck)
  },
  dialog: {
    openFile: (opts) => ipcRenderer.invoke(IPC.dialogOpenFile, opts)
  }
}

contextBridge.exposeInMainWorld('api', api)
