import { createReadStream, createWriteStream } from 'node:fs'
import { mkdtemp, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { dialog, type BrowserWindow, type WebContents } from 'electron'
import { EJSON } from 'bson'
import ExcelJS from 'exceljs'
import type { Document } from 'mongodb'
import type {
  CollectionExportRequest,
  DataOpResult,
  ExportFormat,
  ExportProgress,
  ExportProgressPhase,
  ExportRequest
} from '../../shared/types'
import { IPC } from '../../shared/ipc'
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

const EXT: Record<ExportFormat, string> = {
  json: 'json',
  csv: 'csv',
  tsv: 'tsv',
  xlsx: 'xlsx',
  bson: 'bson'
}

interface ExportTask {
  ownerId: number
  controller: AbortController
}

const exportTasks = new Map<string, ExportTask>()

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

function safeFileName(name: string): string {
  return (name.trim() || 'export').replace(/[\\/:*?"<>|\0]/g, '-')
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
  req: CollectionExportRequest,
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
  const asArray = req.jsonArray !== false
  let count = 0
  report('writing', 0, undefined, true)
  try {
    if (asArray) await writeChunk(stream, '[\n')
    for await (const document of collectionDocuments(req, signal)) {
      const serialized = EJSON.stringify(document, { relaxed: false })
      await writeChunk(stream, asArray ? `${count ? ',\n' : ''}${serialized}` : `${serialized}\n`)
      streamErrors.check()
      count += 1
      report('writing', count)
    }
    throwIfAborted(signal)
    if (asArray) await writeChunk(stream, '\n]\n')
    await new Promise<void>((resolve, reject) => {
      stream.once('error', reject)
      stream.end(resolve)
    })
    report('writing', count, undefined, true)
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
  req: CollectionExportRequest,
  outputPath: string,
  signal: AbortSignal,
  report: ProgressReport
): Promise<number> {
  let count = 0
  report('writing', 0, undefined, true)
  async function* source(): AsyncGenerator<Document> {
    for await (const document of collectionDocuments(req, signal)) {
      count += 1
      report('writing', count)
      yield document
    }
  }
  const written = await streamBsonToFile(source(), outputPath, Boolean(req.gzip))
  report('writing', written, undefined, true)
  return written
}

async function runExport(
  req: ExportRequest,
  filePath: string,
  owner: WebContents,
  signal: AbortSignal
): Promise<DataOpResult> {
  // Keep the completed temporary file beside the destination so the final
  // rename cannot cross filesystem/volume boundaries.
  const tempDir = await mkdtemp(join(dirname(filePath), `.${safeFileName(basename(filePath))}.amdm-export-`))
  const outputPath = join(tempDir, 'output')
  const report = progressReporter(owner, req.taskId)
  try {
    let count: number
    if (req.source === 'collection' && req.format === 'json') {
      count = await exportJson(req, outputPath, signal, report)
    } else if (req.source === 'collection' && req.format === 'bson') {
      count = await exportBson(req, outputPath, signal, report)
    } else count = await exportTabularToFile(req, outputPath, signal, report)
    throwIfAborted(signal)
    report('finalizing', count, count, true)
    await rename(outputPath, filePath)
    return { ok: true, filePath, count }
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}

export async function exportData(
  req: ExportRequest,
  win: BrowserWindow | null,
  owner: WebContents
): Promise<DataOpResult> {
  if (!req.taskId || exportTasks.has(req.taskId)) return { ok: false, error: 'Invalid or duplicate export task id.' }
  const isBson = req.format === 'bson'
  const extension = isBson && req.source === 'collection' && req.gzip ? 'bson.gz' : EXT[req.format]
  const suggestedName = req.source === 'collection' ? req.collection : (req.suggestedName ?? 'result')
  const options = {
    defaultPath: `${safeFileName(suggestedName)}.${extension}`,
    filters: [
      {
        name: req.format === 'xlsx' ? 'Excel' : req.format.toUpperCase(),
        extensions: [extension]
      }
    ]
  }
  const picked = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
  if (picked.canceled || !picked.filePath) return { ok: false, cancelled: true }

  const controller = new AbortController()
  exportTasks.set(req.taskId, { ownerId: owner.id, controller })
  const close = (): void => controller.abort(abortError())
  owner.once('destroyed', close)
  try {
    return await runExport(req, picked.filePath, owner, controller.signal)
  } catch (error) {
    return isAbort(error, controller.signal)
      ? { ok: false, cancelled: true, filePath: picked.filePath }
      : { ok: false, error: errMsg(error), filePath: picked.filePath }
  } finally {
    owner.removeListener('destroyed', close)
    exportTasks.delete(req.taskId)
  }
}
