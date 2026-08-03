import { BrowserWindow, dialog, ipcMain } from 'electron'
import { homedir } from 'node:os'
import { IPC } from '../../shared/ipc'
import { buildMongoUri } from '../../shared/connectionUri'
import type {
  AppSettings,
  ConnectionConfig,
  ConnectionInput,
  DiagnoseScope,
  DocMutateRequest,
  DocSetFieldRequest,
  DocUpdateRequest,
  ExportRequest,
  ImportRequest,
  OpenFileOptions,
  SavedQueryInput,
  ShellRequest
} from '../../shared/types'
import { connectionStore } from '../store/connectionStore'
import { queryStore } from '../store/queryStore'
import { settingsStore } from '../store/settingsStore'
import { sessionManager } from '../mongo/sessionManager'
import { diagnoseConnection } from '../ssh/tunnel'
import type { DecryptedConnection } from '../mongo/uri'
import { listCollections, listDatabases, listIndexes, listUsers, sampleFields } from '../mongo/catalog'
import { executeShell, abortShell } from '../mongo/shellEngine'
import { deleteDocument, setDocumentField, updateDocument } from '../mongo/docOps'
import { exportData } from '../io/exporter'
import { importData } from '../io/importer'
import { checkSparkleForUpdates } from '../sparkle'

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
  const { password, sshPassword, sshPassphrase, jumpSshPassphrase, ...rest } = input
  const config: ConnectionConfig = {
    ...rest,
    hasPassword: !!password,
    hasSshPassword: !!sshPassword,
    hasSshPassphrase: !!sshPassphrase,
    hasJumpSshPassphrase: !!jumpSshPassphrase,
    createdAt: 0,
    updatedAt: 0
  }

  let pw = password
  let sshPw = sshPassword
  let sshPp = sshPassphrase
  let jumpPp = jumpSshPassphrase
  if (input.id) {
    const stored = connectionStore.getDecrypted(input.id)
    if (stored) {
      if (!pw) pw = stored.password
      if (!sshPw) sshPw = stored.sshPassword
      if (!sshPp) sshPp = stored.sshPassphrase
      if (!jumpPp) jumpPp = stored.jumpSshPassphrase
    }
  }
  return { config, password: pw, sshPassword: sshPw, sshPassphrase: sshPp, jumpSshPassphrase: jumpPp }
}

const PASSWORD_PLACEHOLDER = '<password>'

/**
 * Build a connection string from the CURRENT form fields for "To URL" — works
 * while creating or editing. With `includePassword`, inline the plaintext: the
 * just-typed one, else (editing a saved connection without re-typing) the one
 * decrypted from the store. Otherwise emit a readable `<password>` placeholder.
 */
function buildConnectionUri(input: ConnectionInput, includePassword: boolean): string {
  const scram = input.auth.type === 'scram' && !!input.auth.username?.trim()
  let password: string | undefined
  let encodePassword = true
  if (scram) {
    if (includePassword) {
      password = input.password || (input.id ? connectionStore.getDecrypted(input.id)?.password : undefined)
    } else {
      password = PASSWORD_PLACEHOLDER
      encodePassword = false
    }
  }
  return buildMongoUri({
    useSrv: input.useSrv,
    host: input.host.trim(),
    port: input.useSrv ? null : input.port ?? 27017,
    replicaSet: input.replicaSet?.trim() || undefined,
    defaultDatabase: input.defaultDatabase?.trim() || undefined,
    authType: input.auth.type,
    username: input.auth.username?.trim() || undefined,
    password,
    encodePassword,
    authSource: input.auth.authSource?.trim() || undefined,
    tlsEnabled: input.tls.enabled,
    tlsAllowInvalid: !!input.tls.allowInvalidCertificates,
    options: input.options
  })
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
  ipcMain.handle(IPC.connectionsDiagnose, (_e, input: ConnectionInput, scope: DiagnoseScope) =>
    diagnoseConnection(inputToDecrypted(input), scope)
  )
  ipcMain.handle(
    IPC.connectionsBuildUri,
    (_e, input: ConnectionInput, opts: { includePassword: boolean }) =>
      buildConnectionUri(input, !!opts?.includePassword)
  )
  // Native file picker (e.g. choosing an SSH private key). Returns the absolute
  // path, or null if cancelled. `~` in defaultPath is expanded here (the OS
  // dialog does not expand it).
  ipcMain.handle(IPC.dialogOpenFile, async (_e, opts?: OpenFileOptions) => {
    const defaultPath = opts?.defaultPath?.replace(/^~(?=$|[/\\])/, homedir())
    const o: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      title: opts?.title,
      defaultPath,
      filters: opts?.filters
    }
    const win = BrowserWindow.getFocusedWindow()
    const r = win ? await dialog.showOpenDialog(win, o) : await dialog.showOpenDialog(o)
    return r.canceled || !r.filePaths[0] ? null : r.filePaths[0]
  })

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
  // Cancel an in-flight run (slow find/aggregate). Returns false if it already
  // finished — the renderer just clears its spinner either way.
  ipcMain.handle(IPC.shellAbort, (_e, execId: string) => abortShell(execId))

  // saved queries
  ipcMain.handle(IPC.queriesList, () => queryStore.listQueries())
  ipcMain.handle(IPC.queriesSave, (_e, input: SavedQueryInput) => queryStore.saveQuery(input))
  ipcMain.handle(IPC.queriesDelete, (_e, id: string) => queryStore.deleteQuery(id))

  // history
  ipcMain.handle(IPC.historyList, () => queryStore.listHistory())
  ipcMain.handle(IPC.historyClear, () => queryStore.clearHistory())

  // document edit/delete
  ipcMain.handle(IPC.docUpdate, (_e, req: DocUpdateRequest) => updateDocument(req))
  ipcMain.handle(IPC.docSetField, (_e, req: DocSetFieldRequest) => setDocumentField(req))
  ipcMain.handle(IPC.docDelete, (_e, req: DocMutateRequest) => deleteDocument(req))

  // import / export
  ipcMain.handle(IPC.ioExport, (_e, req: ExportRequest) =>
    exportData(req, BrowserWindow.getFocusedWindow())
  )
  ipcMain.handle(IPC.ioImport, (_e, req: ImportRequest) =>
    importData(req, BrowserWindow.getFocusedWindow())
  )

  // settings
  ipcMain.handle(IPC.settingsGet, () => settingsStore.get())
  ipcMain.handle(IPC.settingsUpdate, (_e, patch: Partial<AppSettings>) => settingsStore.update(patch))

  // updates
  ipcMain.handle(IPC.updatesCheck, () => checkSparkleForUpdates())
}
