import { BrowserWindow, ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import type {
  AppSettings,
  ConnectionConfig,
  ConnectionInput,
  DocMutateRequest,
  DocUpdateRequest,
  ExportRequest,
  ImportRequest,
  SavedQueryInput,
  ShellRequest
} from '../../shared/types'
import { connectionStore } from '../store/connectionStore'
import { queryStore } from '../store/queryStore'
import { settingsStore } from '../store/settingsStore'
import { sessionManager } from '../mongo/sessionManager'
import type { DecryptedConnection } from '../mongo/uri'
import { listCollections, listDatabases, listIndexes, listUsers, sampleFields } from '../mongo/catalog'
import { executeShell } from '../mongo/shellEngine'
import { deleteDocument, updateDocument } from '../mongo/docOps'
import { exportData } from '../io/exporter'
import { importData } from '../io/importer'
import { getToolStatus } from '../io/tools'

function historySummary(kind: string, count?: number, elapsedMs?: number, errorName?: string): string {
  if (kind === 'documents') return `${count ?? 0} docs · ${elapsedMs ?? 0}ms`
  if (kind === 'explain') return `explain · ${elapsedMs ?? 0}ms`
  if (kind === 'error') return errorName ?? 'error'
  return `${kind} · ${elapsedMs ?? 0}ms`
}

/**
 * Turn a (possibly partial) ConnectionInput into the decrypted shape used to
 * build a client. Blank secret fields on an existing connection fall back to
 * the stored values so "Test" works after editing without re-typing secrets.
 */
function inputToDecrypted(input: ConnectionInput): DecryptedConnection {
  const { password, sshPassword, sshPassphrase, ...rest } = input
  const config: ConnectionConfig = {
    ...rest,
    hasPassword: !!password,
    hasSshPassword: !!sshPassword,
    hasSshPassphrase: !!sshPassphrase,
    createdAt: 0,
    updatedAt: 0
  }

  let pw = password
  let sshPw = sshPassword
  let sshPp = sshPassphrase
  if (input.id) {
    const stored = connectionStore.getDecrypted(input.id)
    if (stored) {
      if (!pw) pw = stored.password
      if (!sshPw) sshPw = stored.sshPassword
      if (!sshPp) sshPp = stored.sshPassphrase
    }
  }
  return { config, password: pw, sshPassword: sshPw, sshPassphrase: sshPp }
}

export function registerIpc(): void {
  // connections
  ipcMain.handle(IPC.connectionsList, () => connectionStore.listConnections())
  ipcMain.handle(IPC.connectionsSave, (_e, input: ConnectionInput) =>
    connectionStore.saveConnection(input)
  )
  ipcMain.handle(IPC.connectionsDelete, async (_e, id: string) => {
    await sessionManager.disconnect(id)
    connectionStore.deleteConnection(id)
  })
  ipcMain.handle(IPC.connectionsTest, (_e, input: ConnectionInput) =>
    sessionManager.test(inputToDecrypted(input))
  )

  // session
  ipcMain.handle(IPC.sessionConnect, (_e, id: string) => sessionManager.connect(id))
  ipcMain.handle(IPC.sessionDisconnect, (_e, id: string) => sessionManager.disconnect(id))
  ipcMain.handle(IPC.sessionStatus, (_e, id: string) => sessionManager.getStatus(id))

  // catalog
  ipcMain.handle(IPC.catalogDatabases, (_e, id: string) => listDatabases(id))
  ipcMain.handle(IPC.catalogCollections, (_e, id: string, db: string) => listCollections(id, db))
  ipcMain.handle(IPC.catalogIndexes, (_e, id: string, db: string, coll: string) =>
    listIndexes(id, db, coll)
  )
  ipcMain.handle(IPC.catalogUsers, (_e, id: string, db: string) => listUsers(id, db))
  ipcMain.handle(IPC.catalogSampleFields, (_e, id: string, db: string, coll: string) =>
    sampleFields(id, db, coll)
  )

  // shell — run, then record an automatic history entry
  ipcMain.handle(IPC.shellExecute, async (_e, req: ShellRequest) => {
    const result = await executeShell(req)
    queryStore.addHistory({
      code: req.code,
      connectionId: req.connectionId,
      database: req.database,
      ok: result.kind !== 'error',
      summary: historySummary(result.kind, result.count, result.elapsedMs, result.errorName)
    })
    return result
  })

  // saved queries
  ipcMain.handle(IPC.queriesList, () => queryStore.listQueries())
  ipcMain.handle(IPC.queriesSave, (_e, input: SavedQueryInput) => queryStore.saveQuery(input))
  ipcMain.handle(IPC.queriesDelete, (_e, id: string) => queryStore.deleteQuery(id))

  // history
  ipcMain.handle(IPC.historyList, () => queryStore.listHistory())
  ipcMain.handle(IPC.historyClear, () => queryStore.clearHistory())

  // document edit/delete
  ipcMain.handle(IPC.docUpdate, (_e, req: DocUpdateRequest) => updateDocument(req))
  ipcMain.handle(IPC.docDelete, (_e, req: DocMutateRequest) => deleteDocument(req))

  // import / export
  ipcMain.handle(IPC.ioExport, (_e, req: ExportRequest) =>
    exportData(req, BrowserWindow.getFocusedWindow())
  )
  ipcMain.handle(IPC.ioImport, (_e, req: ImportRequest) =>
    importData(req, BrowserWindow.getFocusedWindow())
  )
  ipcMain.handle(IPC.ioToolStatus, () => getToolStatus())

  // settings
  ipcMain.handle(IPC.settingsGet, () => settingsStore.get())
  ipcMain.handle(IPC.settingsUpdate, (_e, patch: Partial<AppSettings>) => settingsStore.update(patch))
}
