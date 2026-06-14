import { createWriteStream } from 'node:fs'
import { dialog, type BrowserWindow } from 'electron'
import { EJSON } from 'bson'
import ExcelJS from 'exceljs'
import type { Document } from 'mongodb'
import type { DataOpResult, ExportRequest } from '../../shared/types'
import { sessionManager } from '../mongo/sessionManager'
import { streamBsonToFile, writeChunk } from './bsonWriteCore'

const EXT: Record<ExportRequest['format'], string> = {
  json: 'json',
  csv: 'csv',
  xlsx: 'xlsx',
  bson: 'bson'
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// --- value flattening for tabular (CSV/XLSX) formats ---

function isPlainObj(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    !(v instanceof Date) &&
    !('_bsontype' in (v as Record<string, unknown>))
  )
}

type Cell = string | number | boolean | Date | null

/** Render a raw BSON value as a spreadsheet cell. */
function toCell(v: unknown): Cell {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return v
  const t = typeof v
  if (t === 'number' || t === 'boolean' || t === 'string') return v as Cell
  if (t === 'object') {
    const o = v as Record<string, unknown>
    const bt = o._bsontype as string | undefined
    if (bt === 'ObjectId' || bt === 'Decimal128' || bt === 'UUID') return o.toString()
    if (bt === 'Long') {
      const n = Number(o.toString())
      return Number.isSafeInteger(n) ? n : o.toString()
    }
    if (bt) return o.toString()
    try {
      return EJSON.stringify(v as Document, { relaxed: true })
    } catch {
      return String(v)
    }
  }
  return String(v)
}

function deriveColumns(docs: Document[]): string[] {
  const seen = new Set<string>()
  const cols: string[] = []
  for (const doc of docs) {
    for (const [key, val] of Object.entries(doc)) {
      if (isPlainObj(val)) {
        const children = Object.keys(val)
        if (children.length === 0) {
          if (!seen.has(key)) seen.add(key), cols.push(key)
        } else {
          for (const ck of children) {
            const col = `${key}.${ck}`
            if (!seen.has(col)) seen.add(col), cols.push(col)
          }
        }
      } else if (!seen.has(key)) {
        seen.add(key)
        cols.push(key)
      }
    }
  }
  return cols
}

function cellFor(doc: Document, column: string): Cell {
  const dot = column.indexOf('.')
  if (dot === -1) return toCell(doc[column])
  const parent = doc[column.slice(0, dot)]
  if (isPlainObj(parent)) return toCell(parent[column.slice(dot + 1)])
  return null
}

// --- format writers ---

async function exportJson(
  cursor: AsyncIterable<Document>,
  filePath: string,
  asArray: boolean
): Promise<number> {
  const stream = createWriteStream(filePath, 'utf8')
  let count = 0
  try {
    if (asArray) await writeChunk(stream, '[\n')
    for await (const doc of cursor) {
      const s = EJSON.stringify(doc, { relaxed: false })
      await writeChunk(stream, asArray ? `${count ? ',\n' : ''}${s}` : `${s}\n`)
      count++
    }
    if (asArray) await writeChunk(stream, '\n]\n')
  } finally {
    await new Promise<void>((resolve) => stream.end(resolve))
  }
  return count
}

async function exportTabular(docs: Document[], filePath: string, xlsx: boolean): Promise<number> {
  const columns = deriveColumns(docs)
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('export')
  ws.columns = (columns.length ? columns : ['(empty)']).map((c) => ({ header: c, key: c, width: 22 }))
  for (const doc of docs) {
    const row: Record<string, Cell> = {}
    for (const c of columns) row[c] = cellFor(doc, c)
    ws.addRow(row)
  }
  if (xlsx) await wb.xlsx.writeFile(filePath)
  else await wb.csv.writeFile(filePath)
  return docs.length
}

/**
 * Native BSON export — a thin session wrapper that resolves the active cursor
 * (with the optional EJSON filter + limit) and hands it to the streaming writer
 * (`streamBsonToFile`, where the bounded-memory + gzip + cleanup logic lives).
 */
async function exportBson(req: ExportRequest, filePath: string): Promise<DataOpResult> {
  const client = sessionManager.getClient(req.connectionId)
  const filter = req.query && req.query.trim() ? (EJSON.parse(req.query) as Document) : {}
  let cursor = client.db(req.database).collection(req.collection).find(filter)
  if (req.limit && req.limit > 0) cursor = cursor.limit(req.limit)
  const count = await streamBsonToFile(cursor, filePath, Boolean(req.gzip))
  return { ok: true, filePath, count }
}

async function exportNative(req: ExportRequest, filePath: string): Promise<DataOpResult> {
  const client = sessionManager.getClient(req.connectionId)
  const filter = req.query && req.query.trim() ? (EJSON.parse(req.query) as Document) : {}
  let cursor = client.db(req.database).collection(req.collection).find(filter)
  if (req.limit && req.limit > 0) cursor = cursor.limit(req.limit)

  if (req.format === 'json') {
    const count = await exportJson(cursor, filePath, req.jsonArray !== false)
    return { ok: true, filePath, count }
  }
  // CSV/XLSX buffer the (bounded) result to derive columns.
  const docs = (await cursor.toArray()) as Document[]
  const count = await exportTabular(docs, filePath, req.format === 'xlsx')
  return { ok: true, filePath, count }
}

export async function exportData(
  req: ExportRequest,
  win: BrowserWindow | null
): Promise<DataOpResult> {
  const isBson = req.format === 'bson'
  const ext = isBson && req.gzip ? 'bson.gz' : EXT[req.format]
  const opts = {
    defaultPath: `${req.collection}.${ext}`,
    filters: [{ name: req.format.toUpperCase(), extensions: isBson ? ['bson', 'gz'] : [ext] }]
  }
  const picked = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
  if (picked.canceled || !picked.filePath) return { ok: false, cancelled: true }
  const filePath = picked.filePath
  try {
    return req.format === 'bson'
      ? await exportBson(req, filePath)
      : await exportNative(req, filePath)
  } catch (e) {
    return { ok: false, error: errMsg(e), filePath }
  }
}
