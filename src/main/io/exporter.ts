import { COPYFILE_EXCL } from 'node:constants'
import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { copyFile, link, lstat, mkdtemp, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { app, dialog, shell, type BrowserWindow, type MessageBoxOptions, type WebContents } from 'electron'
import { EJSON } from 'bson'
import ExcelJS from 'exceljs'
import type { Document } from 'mongodb'
import type {
  CollectionExportRequest,
  DataOpResult,
  ExportDirectorySelection,
  ExportFileRequest,
  ExportProgress,
  ExportProgressPhase,
  ExportRequest
} from '../../shared/types'
import { IPC } from '../../shared/ipc'
import { exportFileExtension, sanitizeExportBaseName } from '../../shared/exportDestination'
import { encodeCanonicalJson } from '../../shared/jsonSerialization'
import {
  collectTabularColumns,
  escapeDelimitedField,
  resolveTabularDelimiter,
  sanitizeWorksheetName,
  sortTabularColumns,
  tabularSpreadsheetCell,
  tabularTextCell
} from '../../shared/tabularExport'
import { sessionManager } from '../mongo/sessionManager'
import { streamBsonToFile, writeChunk } from './bsonWriteCore'

interface ExportTask {
  ownerId: number
  controller: AbortController
}

const exportTasks = new Map<string, ExportTask>()
const exportDirectories = new WeakMap<WebContents, ExportDirectorySelection>()
const completedExports = new WeakMap<WebContents, { taskId: string; filePath: string }>()

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function abortError(): Error {
  const error = new Error('Export cancelled')
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? abortError()
}

function isAbort(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof Error && error.name === 'AbortError')
}

function captureWriteErrors(stream: NodeJS.WritableStream): {
  check: () => void
  dispose: () => void
} {
  let failure: Error | null = null
  const onError = (error: Error): void => {
    failure = error
  }
  stream.on('error', onError)
  return {
    check: (): void => {
      if (failure) throw failure
    },
    dispose: (): void => {
      stream.removeListener('error', onError)
    }
  }
}

function isFileSystemError(error: unknown, code: string): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath)
    return true
  } catch (error) {
    if (isFileSystemError(error, 'ENOENT')) return false
    throw error
  }
}

function directoryDialogTitle(): string {
  const locale = app.getLocale().toLowerCase()
  if (locale.startsWith('zh-tw') || locale.startsWith('zh-hk') || locale.startsWith('zh-mo')) {
    return '選擇匯出目錄'
  }
  if (locale.startsWith('zh')) return '选择导出目录'
  return 'Choose export directory'
}

function overwritePrompt(filePath: string): MessageBoxOptions {
  const locale = app.getLocale().toLowerCase()
  const fileName = basename(filePath)
  if (locale.startsWith('zh-tw') || locale.startsWith('zh-hk') || locale.startsWith('zh-mo')) {
    return {
      type: 'warning',
      title: '確認覆蓋檔案',
      message: `「${fileName}」已存在`,
      detail: '繼續匯出將永久覆蓋原檔案，且無法復原。確定要覆蓋嗎？',
      buttons: ['覆蓋檔案', '取消'],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    }
  }
  if (locale.startsWith('zh')) {
    return {
      type: 'warning',
      title: '确认覆盖文件',
      message: `“${fileName}”已存在`,
      detail: '继续导出将永久覆盖原文件，且无法恢复。确定要覆盖吗？',
      buttons: ['覆盖文件', '取消'],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    }
  }
  return {
    type: 'warning',
    title: 'Confirm file overwrite',
    message: `“${fileName}” already exists`,
    detail: 'Continuing will permanently overwrite the existing file and cannot be undone.',
    buttons: ['Overwrite file', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  }
}

async function confirmOverwrite(filePath: string, win: BrowserWindow | null): Promise<boolean> {
  const options = overwritePrompt(filePath)
  const result = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
  return result.response === 0
}

/** Grant this Renderer an owner-scoped directory chosen through the native picker. */
export async function chooseExportDirectory(
  win: BrowserWindow | null,
  owner: WebContents,
  defaultPath: string
): Promise<ExportDirectorySelection | null> {
  const options: Electron.OpenDialogOptions = {
    title: directoryDialogTitle(),
    defaultPath,
    properties: ['openDirectory', 'createDirectory']
  }
  const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  if (picked.canceled || !picked.filePaths[0]) return null
  const selection = { selectionId: randomUUID(), path: picked.filePaths[0] }
  exportDirectories.set(owner, selection)
  return selection
}

type ProgressReport = (phase: ExportProgressPhase, processed: number, total?: number, force?: boolean) => void

function sendProgress(owner: WebContents, progress: ExportProgress): void {
  if (!owner.isDestroyed()) owner.send(IPC.ioExportProgress, progress)
}

function progressReporter(owner: WebContents, taskId: string): ProgressReport {
  let lastAt = 0
  let lastPhase: ExportProgressPhase | null = null
  return (phase, processed, total, force = false): void => {
    const now = Date.now()
    if (!force && phase === lastPhase && processed > 0 && processed % 100 !== 0 && now - lastAt < 120) return
    lastAt = now
    lastPhase = phase
    sendProgress(owner, { taskId, phase, processed, total })
  }
}

/** Cancel only a task owned by the requesting Renderer. */
export function cancelExport(taskId: string, ownerId: number): boolean {
  const task = exportTasks.get(taskId)
  if (!task || task.ownerId !== ownerId) return false
  task.controller.abort(abortError())
  return true
}

async function* collectionDocuments(req: CollectionExportRequest, signal: AbortSignal): AsyncGenerator<Document> {
  const client = sessionManager.getClient(req.connectionId)
  const filter = req.query?.trim() ? (EJSON.parse(req.query) as Document) : {}
  let cursor = client.db(req.database).collection(req.collection).find(filter)
  if (req.limit && req.limit > 0) cursor = cursor.limit(req.limit)
  const close = (): void => {
    void cursor.close().catch(() => {})
  }
  signal.addEventListener('abort', close, { once: true })
  try {
    for await (const document of cursor) {
      throwIfAborted(signal)
      yield document
    }
  } finally {
    signal.removeEventListener('abort', close)
    await cursor.close().catch(() => {})
  }
}

async function* canonicalDocuments(req: ExportRequest, signal: AbortSignal): AsyncGenerator<unknown> {
  if (req.source === 'result') {
    for (const document of req.documents) {
      throwIfAborted(signal)
      yield document
    }
    return
  }
  for await (const document of collectionDocuments(req, signal)) {
    yield EJSON.serialize(document, { relaxed: false })
  }
}

async function spoolTabular(
  req: ExportRequest,
  spoolPath: string,
  signal: AbortSignal,
  report: ProgressReport
): Promise<{ columns: string[]; count: number }> {
  const stream = createWriteStream(spoolPath, 'utf8')
  const streamErrors = captureWriteErrors(stream)
  const abort = (): void => {
    stream.destroy()
  }
  signal.addEventListener('abort', abort, { once: true })
  const seen = new Set<string>()
  const columns: string[] = []
  const total = req.source === 'result' ? req.documents.length : undefined
  let count = 0
  report('scanning', 0, total, true)
  try {
    for await (const document of canonicalDocuments(req, signal)) {
      collectTabularColumns(document, seen, columns)
      await writeChunk(stream, `${JSON.stringify(document)}\n`)
      streamErrors.check()
      count += 1
      report('scanning', count, total)
    }
    throwIfAborted(signal)
    streamErrors.check()
    await new Promise<void>((resolve, reject) => {
      stream.once('error', reject)
      stream.end(resolve)
    })
    report('scanning', count, total, true)
    return {
      columns: sortTabularColumns(columns, req.fieldSort ?? 'alpha'),
      count
    }
  } catch (error) {
    stream.destroy()
    throw error
  } finally {
    signal.removeEventListener('abort', abort)
    streamErrors.dispose()
  }
}

async function forEachSpooled(
  spoolPath: string,
  signal: AbortSignal,
  visit: (document: unknown, index: number) => Promise<void>
): Promise<number> {
  const input = createReadStream(spoolPath, 'utf8')
  const abort = (): void => {
    input.destroy()
  }
  signal.addEventListener('abort', abort, { once: true })
  const lines = createInterface({ input, crlfDelay: Infinity })
  let count = 0
  try {
    for await (const line of lines) {
      throwIfAborted(signal)
      if (!line) continue
      await visit(JSON.parse(line) as unknown, count)
      count += 1
    }
    throwIfAborted(signal)
    return count
  } finally {
    signal.removeEventListener('abort', abort)
    lines.close()
    input.destroy()
  }
}

async function writeDelimited(
  req: ExportRequest,
  spoolPath: string,
  outputPath: string,
  columns: string[],
  total: number,
  signal: AbortSignal,
  report: ProgressReport
): Promise<void> {
  if (req.format !== 'csv' && req.format !== 'tsv') {
    throw new Error(`Unsupported delimited export format: ${req.format}`)
  }
  const delimiter = resolveTabularDelimiter(req.format, req.delimiter)
  const lineEnding = req.lineEnding === 'lf' ? '\n' : '\r\n'
  const stream = createWriteStream(outputPath, 'utf8')
  const streamErrors = captureWriteErrors(stream)
  const abort = (): void => {
    stream.destroy()
  }
  signal.addEventListener('abort', abort, { once: true })
  report('writing', 0, total, true)
  try {
    if (req.utf8Bom !== false) await writeChunk(stream, '\uFEFF')
    if (req.includeHeader !== false && columns.length > 0) {
      await writeChunk(
        stream,
        `${columns.map((column) => escapeDelimitedField(column, delimiter)).join(delimiter)}${lineEnding}`
      )
    }
    await forEachSpooled(spoolPath, signal, async (document, index) => {
      const row = columns
        .map((column) => escapeDelimitedField(tabularTextCell(document, column), delimiter))
        .join(delimiter)
      await writeChunk(stream, `${row}${lineEnding}`)
      streamErrors.check()
      report('writing', index + 1, total)
    })
    await new Promise<void>((resolve, reject) => {
      stream.once('error', reject)
      stream.end(resolve)
    })
    report('writing', total, total, true)
  } catch (error) {
    stream.destroy()
    throw error
  } finally {
    signal.removeEventListener('abort', abort)
    streamErrors.dispose()
  }
}

async function writeXlsx(
  req: ExportRequest,
  spoolPath: string,
  outputPath: string,
  columns: string[],
  total: number,
  signal: AbortSignal,
  report: ProgressReport
): Promise<void> {
  const output = createWriteStream(outputPath)
  const streamErrors = captureWriteErrors(output)
  const abort = (): void => {
    output.destroy()
  }
  signal.addEventListener('abort', abort, { once: true })
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: output,
    useSharedStrings: false,
    useStyles: false
  })
  const worksheet = workbook.addWorksheet(sanitizeWorksheetName(req.worksheetName ?? 'Result'))
  worksheet.columns = columns.map(() => ({ width: 22 }))
  if (req.includeHeader !== false && columns.length > 0) worksheet.addRow(columns).commit()
  report('writing', 0, total, true)
  try {
    await forEachSpooled(spoolPath, signal, async (document, index) => {
      worksheet.addRow(columns.map((column) => tabularSpreadsheetCell(document, column))).commit()
      report('writing', index + 1, total)
    })
    throwIfAborted(signal)
    worksheet.commit()
    await workbook.commit()
    streamErrors.check()
    report('writing', total, total, true)
  } catch (error) {
    output.destroy()
    throw error
  } finally {
    signal.removeEventListener('abort', abort)
    streamErrors.dispose()
  }
}

export async function exportTabularToFile(
  req: ExportRequest,
  outputPath: string,
  signal: AbortSignal,
  report: ProgressReport = () => {}
): Promise<number> {
  if (req.format !== 'csv' && req.format !== 'tsv' && req.format !== 'xlsx') {
    throw new Error(`Unsupported tabular export format: ${req.format}`)
  }
  const tempDir = await mkdtemp(join(tmpdir(), 'amdm-export-spool-'))
  const spoolPath = join(tempDir, 'documents.ndjson')
  try {
    const { columns, count } = await spoolTabular(req, spoolPath, signal, report)
    if (req.format === 'xlsx') {
      await writeXlsx(req, spoolPath, outputPath, columns, count, signal, report)
    } else {
      await writeDelimited(req, spoolPath, outputPath, columns, count, signal, report)
    }
    return count
  } catch (error) {
    await rm(outputPath, { force: true }).catch(() => {})
    throw error
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}

async function exportJson(
  req: ExportRequest,
  outputPath: string,
  signal: AbortSignal,
  report: ProgressReport
): Promise<number> {
  const stream = createWriteStream(outputPath, 'utf8')
  const streamErrors = captureWriteErrors(stream)
  const abort = (): void => {
    stream.destroy()
  }
  signal.addEventListener('abort', abort, { once: true })
  const asArray = req.format === 'json'
  const encoding = req.jsonEncoding ?? 'plain'
  const total = req.source === 'result' ? req.documents.length : undefined
  let count = 0
  report('writing', 0, total, true)
  try {
    if (asArray) await writeChunk(stream, '[\n')
    for await (const document of canonicalDocuments(req, signal)) {
      const serialized = JSON.stringify(encodeCanonicalJson(document, encoding))
      await writeChunk(stream, asArray ? `${count ? ',\n' : ''}${serialized}` : `${serialized}\n`)
      streamErrors.check()
      count += 1
      report('writing', count, total)
    }
    throwIfAborted(signal)
    if (asArray) await writeChunk(stream, '\n]\n')
    await new Promise<void>((resolve, reject) => {
      stream.once('error', reject)
      stream.end(resolve)
    })
    report('writing', count, total, true)
    return count
  } catch (error) {
    stream.destroy()
    throw error
  } finally {
    signal.removeEventListener('abort', abort)
    streamErrors.dispose()
  }
}

async function exportBson(
  req: ExportRequest,
  outputPath: string,
  signal: AbortSignal,
  report: ProgressReport
): Promise<number> {
  const total = req.source === 'result' ? req.documents.length : undefined
  let count = 0
  report('writing', 0, total, true)
  async function* source(): AsyncGenerator<Document> {
    const documents = req.source === 'collection' ? collectionDocuments(req, signal) : canonicalDocuments(req, signal)
    for await (const document of documents) {
      const bsonDocument =
        req.source === 'collection' ? document : EJSON.parse(JSON.stringify(document), { relaxed: false })
      if (typeof bsonDocument !== 'object' || bsonDocument === null || Array.isArray(bsonDocument)) {
        throw new Error('BSON export requires top-level document values.')
      }
      const prototype = Object.getPrototypeOf(bsonDocument)
      if (prototype !== Object.prototype && prototype !== null) {
        throw new Error('BSON export requires top-level document values.')
      }
      count += 1
      report('writing', count, total)
      yield bsonDocument as Document
    }
  }
  const written = await streamBsonToFile(source(), outputPath, req.source === 'collection' && Boolean(req.gzip))
  report('writing', written, total, true)
  return written
}

async function runExport(
  req: ExportRequest,
  filePath: string,
  overwrite: boolean,
  owner: WebContents,
  signal: AbortSignal
): Promise<DataOpResult> {
  // Keep the completed temporary file beside the destination so the final
  // rename cannot cross filesystem/volume boundaries.
  const tempDir = await mkdtemp(
    join(dirname(filePath), `.${sanitizeExportBaseName(basename(filePath))}.amdm-export-`)
  )
  const outputPath = join(tempDir, 'output')
  const report = progressReporter(owner, req.taskId)
  try {
    let count: number
    if (req.format === 'json' || req.format === 'jsonl') {
      count = await exportJson(req, outputPath, signal, report)
    } else if (req.format === 'bson') {
      count = await exportBson(req, outputPath, signal, report)
    } else count = await exportTabularToFile(req, outputPath, signal, report)
    throwIfAborted(signal)
    report('finalizing', count, count, true)
    if (overwrite) {
      await rename(outputPath, filePath)
    } else {
      try {
        await link(outputPath, filePath)
      } catch (error) {
        if (isFileSystemError(error, 'EEXIST')) {
          throw new Error('The export file now exists. Retry and confirm overwrite.')
        }
        if (
          !isFileSystemError(error, 'EPERM') &&
          !isFileSystemError(error, 'ENOTSUP') &&
          !isFileSystemError(error, 'EOPNOTSUPP')
        ) {
          throw error
        }
        await copyFile(outputPath, filePath, COPYFILE_EXCL)
      }
    }
    return { ok: true, filePath, count }
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}

export async function exportData(
  req: ExportFileRequest,
  win: BrowserWindow | null,
  owner: WebContents
): Promise<DataOpResult> {
  if (!req.taskId || exportTasks.has(req.taskId)) return { ok: false, error: 'Invalid or duplicate export task id.' }
  const directory = exportDirectories.get(owner)
  if (!directory || !req.destination || directory.selectionId !== req.destination.directorySelectionId) {
    return { ok: false, error: 'Export directory selection is no longer available. Choose it again.' }
  }
  if (typeof req.destination.fileName !== 'string' || !req.destination.fileName.trim()) {
    return { ok: false, error: 'Export file name is required.' }
  }
  const gzip = req.source === 'collection' && req.format === 'bson' && Boolean(req.gzip)
  const extension = exportFileExtension(req.format, gzip)
  const filePath = join(directory.path, `${sanitizeExportBaseName(req.destination.fileName)}.${extension}`)
  const exists = await pathExists(filePath)
  if (exists && !(await confirmOverwrite(filePath, win))) {
    return { ok: false, cancelled: true, filePath }
  }

  const controller = new AbortController()
  exportTasks.set(req.taskId, { ownerId: owner.id, controller })
  const close = (): void => controller.abort(abortError())
  owner.once('destroyed', close)
  try {
    const result = await runExport(req, filePath, exists, owner, controller.signal)
    if (result.ok && result.filePath) {
      completedExports.set(owner, { taskId: req.taskId, filePath: result.filePath })
    }
    return result
  } catch (error) {
    return isAbort(error, controller.signal)
      ? { ok: false, cancelled: true, filePath }
      : { ok: false, error: errMsg(error), filePath }
  } finally {
    owner.removeListener('destroyed', close)
    exportTasks.delete(req.taskId)
  }
}

/** Open only the latest export completed by this Renderer; do not expose an arbitrary-path shell bridge. */
export async function openExportedFile(taskId: string, owner: WebContents): Promise<string | null> {
  const completed = completedExports.get(owner)
  if (!completed || completed.taskId !== taskId) return 'Exported file is no longer available.'
  return (await shell.openPath(completed.filePath)) || null
}

/** Reveal only the latest export completed by this Renderer in the platform file manager. */
export function revealExportedFile(taskId: string, owner: WebContents): string | null {
  const completed = completedExports.get(owner)
  if (!completed || completed.taskId !== taskId) return 'Exported file is no longer available.'
  shell.showItemInFolder(completed.filePath)
  return null
}
