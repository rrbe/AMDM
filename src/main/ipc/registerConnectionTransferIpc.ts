import { BrowserWindow, clipboard, dialog, ipcMain, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { open, rename, rm, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type {
  ConnectionExportRequest,
  ConnectionImportPreview,
  ConnectionImportRequest,
  ConnectionImportResult,
  ConnectionTransferResult
} from '../../shared/connectionTransfer'
import type { ConnectionConfig, ConnectionInput } from '../../shared/types'
import { IPC } from '../../shared/ipc'
import {
  CONNECTION_TRANSFER_ERROR_CODES,
  decodeConnections,
  encodeConnections,
  type TransferRecord
} from '../io/connectionTransferCore'
import { connectionStore } from '../store/connectionStore'
import { settingsStore } from '../store/settingsStore'
import { sessionManager } from '../mongo/desktopSession'

const MAX_BYTES = 16 * 1024 * 1024
const MAX_CONNECTIONS = 10_000
const PREVIEW_LIFETIME = 20 * 60 * 1000
const FORMATS = new Set(['amdm', 'urls', 'compass', 'studio3t', 'nosqlbooster', 'robo3t'])
const CORE_ERRORS = new Set<string>(CONNECTION_TRANSFER_ERROR_CODES)
const SECRET_FIELDS = ['password', 'sshPassword', 'sshPassphrase', 'jumpSshPassphrase'] as const
const SECRET_FLAGS = ['hasPassword', 'hasSshPassword', 'hasSshPassphrase', 'hasJumpSshPassphrase'] as const

interface Preview {
  token: string
  fileName: string
  text: string
  records?: TransferRecord[]
  revision: number
  timer: ReturnType<typeof setTimeout>
}

const previews = new Map<WebContents, Preview>()
const watchedOwners = new WeakSet<WebContents>()
const exporting = new WeakSet<WebContents>()

function release(owner: WebContents, token?: string): void {
  const preview = previews.get(owner)
  if (!preview || (token !== undefined && preview.token !== token)) return
  clearTimeout(preview.timer)
  previews.delete(owner)
}

function watchOwner(owner: WebContents): void {
  if (watchedOwners.has(owner)) return
  watchedOwners.add(owner)
  owner.once('destroyed', () => release(owner))
  owner.on('did-navigate', () => release(owner))
  owner.on('render-process-gone', () => release(owner))
}

/** Only explicitly validated core codes can reach Renderer; parser errors can contain credentials. */
function coreError(error: unknown): string {
  const code = error instanceof Error ? error.message : ''
  return CORE_ERRORS.has(code) ? code : 'invalidFile'
}

function sanitized(input: ConnectionInput): ConnectionConfig {
  const { password, sshPassword, sshPassphrase, jumpSshPassphrase, copyFromId, ...config } = input
  return {
    ...config,
    id: '',
    createdAt: 0,
    updatedAt: 0,
    hasPassword: !!password,
    hasSshPassword: !!sshPassword,
    hasSshPassphrase: !!sshPassphrase,
    hasJumpSshPassphrase: !!jumpSshPassphrase
  }
}

async function previewImport(
  owner: WebContents,
  request: { token?: string; passphrase?: string }
): Promise<ConnectionImportPreview | null> {
  if (owner.isDestroyed()) return null
  if (
    !request ||
    (request.passphrase !== undefined && (typeof request.passphrase !== 'string' || request.passphrase.length > 1024))
  ) {
    return { token: '', fileName: '', rows: [], error: 'invalidRequest' }
  }
  watchOwner(owner)
  let preview: Preview | undefined
  if (request.token !== undefined) {
    preview = previews.get(owner)
    if (!preview || preview.token !== request.token) {
      return { token: '', fileName: '', rows: [], error: 'expiredPreview' }
    }
  } else {
    release(owner)
    const window = BrowserWindow.fromWebContents(owner)
    const options = {
      title: 'Import connections',
      properties: ['openFile'] as ['openFile'],
      filters: [{ name: 'Connection files', extensions: ['json', 'uri', 'txt'] }]
    }
    const selection = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    if (selection.canceled || !selection.filePaths[0] || owner.isDestroyed()) return null
    const fileName = basename(selection.filePaths[0])
    let text: string
    try {
      const file = await open(selection.filePaths[0], 'r')
      try {
        const stat = await file.stat()
        if (!stat.isFile() || stat.size > MAX_BYTES) {
          return { token: '', fileName, rows: [], error: 'fileTooLarge' }
        }
        // Cap the stream even if another process grows the file after stat.
        const stream = file.createReadStream({
          autoClose: false,
          start: 0,
          end: MAX_BYTES,
          signal: AbortSignal.timeout(30_000)
        })
        const chunks: Buffer[] = []
        let length = 0
        for await (const chunk of stream) {
          if (owner.isDestroyed()) return null
          length += chunk.length
          chunks.push(chunk as Buffer)
        }
        if (length > MAX_BYTES) return { token: '', fileName, rows: [], error: 'fileTooLarge' }
        if (length > stat.size) return { token: '', fileName, rows: [], error: 'readFailed' }
        text = Buffer.concat(chunks, length).toString('utf8')
      } finally {
        await file.close()
      }
    } catch {
      return { token: '', fileName, rows: [], error: 'readFailed' }
    }
    if (owner.isDestroyed()) return null
    const token = randomUUID()
    preview = {
      token,
      fileName,
      text,
      revision: 0,
      timer: setTimeout(() => release(owner, token), PREVIEW_LIFETIME)
    }
    preview.timer.unref()
    release(owner)
    previews.set(owner, preview)
  }
  const revision = ++preview.revision
  preview.records = undefined
  try {
    const records = await decodeConnections(preview.text, request.passphrase)
    if (previews.get(owner) !== preview || preview.revision !== revision || owner.isDestroyed()) return null
    preview.records = records
    return {
      token: preview.token,
      fileName: preview.fileName,
      rows: records.map((record, index) => ({
        index,
        name: record.input.name,
        config: record.error ? null : sanitized(record.input),
        warnings: record.warnings,
        error: record.error
      }))
    }
  } catch (error) {
    if (previews.get(owner) !== preview || preview.revision !== revision || owner.isDestroyed()) return null
    const code = coreError(error)
    return {
      token: preview.token,
      fileName: preview.fileName,
      rows: [],
      error: code,
      needsPassword: code === 'passwordRequired' || code === 'invalidPassword'
    }
  }
}

function applyImport(owner: WebContents, request: ConnectionImportRequest): ConnectionImportResult {
  if (owner.isDestroyed()) return { cancelled: true }
  const preview = previews.get(owner)
  if (!preview || !request || preview.token !== request.token || !preview.records) return { error: 'expiredPreview' }
  if (!Array.isArray(request.entries) || !request.entries.length || request.entries.length > MAX_CONNECTIONS) {
    return { error: 'invalidRequest' }
  }
  const current = connectionStore.listConnections()
  const names = new Set(current.map((connection) => connection.name))
  const targets = new Set<string>()
  const indices = new Set<number>()
  const inputs: ConnectionInput[] = []
  // Preserve the source file's order for newly appended connections.
  for (const entry of [...request.entries].sort((a, b) => a?.index - b?.index)) {
    if (!entry || !Number.isInteger(entry.index) || indices.has(entry.index)) return { error: 'invalidRequest' }
    indices.add(entry.index)
    const record = preview.records[entry.index]
    if (!record || record.error) return { error: 'invalidRequest' }
    if (record.warnings.length && request.acknowledgeWarnings !== true) return { error: 'warningsRequired' }
    let name = record.input.name
    if (entry.replaceId !== undefined) {
      if (
        typeof entry.replaceId !== 'string' ||
        !current.some((connection) => connection.id === entry.replaceId) ||
        targets.has(entry.replaceId)
      )
        return { error: 'invalidRequest' }
      if (sessionManager.getStatus(entry.replaceId).state !== 'disconnected') return { error: 'connected' }
      targets.add(entry.replaceId)
    } else {
      const base = name
      for (let suffix = 2; names.has(name); suffix++) name = `${base} (${suffix})`
    }
    names.add(name)
    const input: ConnectionInput = {
      ...record.input,
      id: entry.replaceId ?? '',
      name
    }
    // A replacement is the file's complete configuration, never a merge of old credentials.
    for (const field of SECRET_FIELDS) input[field] ??= ''
    inputs.push(input)
  }
  try {
    connectionStore.importConnections(inputs)
  } catch {
    return { error: 'writeFailed' }
  }
  release(owner, preview.token)
  return {
    count: inputs.length,
    connections: connectionStore.listConnections(),
    settings: settingsStore.get(),
    replacedIds: [...targets]
  }
}

async function exportConnections(
  owner: WebContents,
  request: ConnectionExportRequest
): Promise<ConnectionTransferResult> {
  if (owner.isDestroyed()) return { cancelled: true }
  if (
    !request ||
    !Array.isArray(request.ids) ||
    !request.ids.length ||
    request.ids.length > MAX_CONNECTIONS ||
    new Set(request.ids).size !== request.ids.length ||
    !FORMATS.has(request.format) ||
    typeof request.includeSecrets !== 'boolean' ||
    !['file', 'clipboard'].includes(request.destination) ||
    (request.passphrase !== undefined &&
      (typeof request.passphrase !== 'string' || request.passphrase.length > 1024)) ||
    (request.destination === 'clipboard' && ['amdm', 'compass'].includes(request.format))
  ) {
    return { error: 'invalidRequest' }
  }
  if (request.format === 'amdm' && request.includeSecrets && !request.passphrase) return { error: 'passwordRequired' }
  if (exporting.has(owner)) return { error: 'busy' }
  exporting.add(owner)
  let temporary: string | undefined
  try {
    let path: string | undefined
    if (request.destination === 'file') {
      const extension = ['amdm', 'compass'].includes(request.format)
        ? 'json'
        : request.format === 'studio3t'
          ? 'uri'
          : 'txt'
      const window = BrowserWindow.fromWebContents(owner)
      const options = {
        title: 'Export connections',
        defaultPath: `${request.format}-connections.${extension}`,
        filters: [{ name: 'Connection file', extensions: [extension] }]
      }
      const selection = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)
      if (selection.canceled || !selection.filePath) return { cancelled: true }
      path = selection.filePath
    }
    if (owner.isDestroyed()) return { cancelled: true }
    // Resolve after the picker closes so deletion or edits while it was open cannot export stale data.
    const saved = new Map(connectionStore.listConnections().map((config) => [config.id, config]))
    const inputs: ConnectionInput[] = []
    for (const id of request.ids) {
      const config = saved.get(id)
      if (!config) return { error: 'missingConnection' }
      const { hasPassword, hasSshPassword, hasSshPassphrase, hasJumpSshPassphrase, createdAt, updatedAt, ...input } =
        config
      const decrypted = request.includeSecrets ? connectionStore.getDecrypted(id) : null
      if (request.includeSecrets) {
        const secretCount = ['amdm', 'compass'].includes(request.format) ? SECRET_FIELDS.length : 1
        for (let index = 0; index < secretCount; index++) {
          if (config[SECRET_FLAGS[index]] && decrypted?.[SECRET_FIELDS[index]] === undefined) {
            return { error: 'secretUnavailable' }
          }
        }
      }
      inputs.push({
        ...input,
        ...(decrypted ? Object.fromEntries(SECRET_FIELDS.map((field) => [field, decrypted[field]])) : {})
      })
    }
    const output = await encodeConnections(inputs, request.format, request.includeSecrets, request.passphrase)
    if (owner.isDestroyed()) return { cancelled: true }
    if (Buffer.byteLength(output, 'utf8') > MAX_BYTES) return { error: 'fileTooLarge' }
    if (path) {
      temporary = `${path}.${randomUUID()}.tmp`
      await writeFile(temporary, output, {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
        signal: AbortSignal.timeout(30_000)
      })
      if (owner.isDestroyed()) return { cancelled: true }
      await rename(temporary, path)
    } else {
      clipboard.writeText(output)
    }
    return { count: inputs.length }
  } catch (error) {
    return {
      error: error instanceof Error && CORE_ERRORS.has(error.message) ? error.message : 'writeFailed'
    }
  } finally {
    exporting.delete(owner)
    if (temporary) await rm(temporary, { force: true })
  }
}

export function registerConnectionTransferIpc(): void {
  ipcMain.handle(IPC.connectionsExport, (event, request: ConnectionExportRequest) =>
    exportConnections(event.sender, request)
  )
  ipcMain.handle(IPC.connectionsImportPreview, (event, request: { token?: string; passphrase?: string }) =>
    previewImport(event.sender, request)
  )
  ipcMain.handle(IPC.connectionsImportApply, (event, request: ConnectionImportRequest) =>
    applyImport(event.sender, request)
  )
  ipcMain.handle(IPC.connectionsImportRelease, (event, token: string) => release(event.sender, token))
}
