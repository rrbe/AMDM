import { readFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { dialog, type BrowserWindow } from 'electron'
import { EJSON } from 'bson'
import ExcelJS from 'exceljs'
import type { Document } from 'mongodb'
import type { DataOpResult, ImportRequest } from '../../shared/types'
import { sessionManager } from '../mongo/sessionManager'
import { connectionStore } from '../store/connectionStore'
import { buildToolBaseArgs } from './connArgs'
import { requireTool } from './tools'

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

const OPEN_FILTERS: Record<ImportRequest['format'], { name: string; extensions: string[] }> = {
  json: { name: 'JSON', extensions: ['json', 'ndjson'] },
  csv: { name: 'CSV', extensions: ['csv'] },
  xlsx: { name: 'Excel', extensions: ['xlsx'] },
  bson: { name: 'BSON archive', extensions: ['archive', 'bson', 'gz'] }
}

// --- parsing ---

function parseJsonDocs(content: string): Document[] {
  const trimmed = content.trim()
  if (!trimmed) return []
  if (trimmed.startsWith('[')) {
    const arr = EJSON.parse(trimmed) as unknown
    return Array.isArray(arr) ? (arr as Document[]) : []
  }
  // NDJSON: one document per non-empty line.
  return trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => EJSON.parse(l) as Document)
}

function normalizeCell(v: unknown): unknown {
  if (v === null || v === undefined) return undefined
  if (v instanceof Date) return v
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (typeof o.text === 'string') return o.text // hyperlink / richText
    if ('result' in o) return o.result // formula
    return String(v)
  }
  return v
}

function worksheetToDocs(ws: ExcelJS.Worksheet): Document[] {
  const headers: string[] = []
  ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col] = String(cell.value ?? '').trim()
  })
  const docs: Document[] = []
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return
    const doc: Document = {}
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      const h = headers[col]
      if (!h) return
      const val = normalizeCell(cell.value)
      if (val !== undefined && val !== '') doc[h] = val
    })
    if (Object.keys(doc).length) docs.push(doc)
  })
  return docs
}

// --- insertion ---

async function insertDocs(
  connectionId: string,
  database: string,
  collection: string,
  docs: Document[]
): Promise<{ inserted: number; failures: number }> {
  if (!docs.length) return { inserted: 0, failures: 0 }
  const col = sessionManager.getClient(connectionId).db(database).collection(collection)
  const BATCH = 1000
  let inserted = 0
  let failures = 0
  for (let i = 0; i < docs.length; i += BATCH) {
    const slice = docs.slice(i, i + BATCH)
    try {
      const res = await col.insertMany(slice, { ordered: false })
      inserted += res.insertedCount
    } catch (e) {
      // Partial success (e.g. duplicate _id) — count what made it through.
      const r = (e as { result?: { insertedCount?: number; nInserted?: number } }).result
      const ok = r?.insertedCount ?? r?.nInserted ?? 0
      inserted += ok
      failures += slice.length - ok
    }
  }
  return { inserted, failures }
}

function runTool(toolPath: string, args: string[]): Promise<{ stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(toolPath, args, { maxBuffer: 64 * 1024 * 1024 }, (err, _stdout, stderr) => {
      if (err) reject(new Error(stderr?.trim() || err.message))
      else resolve({ stderr: stderr ?? '' })
    })
  })
}

async function importBson(req: ImportRequest, filePath: string): Promise<DataOpResult> {
  const tool = requireTool('mongorestore')
  const dec = connectionStore.getDecrypted(req.connectionId)
  if (!dec) return { ok: false, error: 'Connection not found', filePath }
  const tunnelPort = sessionManager.getTunnelPort(req.connectionId)
  const args = [...buildToolBaseArgs(dec, tunnelPort, req.database, false), `--archive=${filePath}`]
  const { stderr } = await runTool(tool, args)
  const m = /(\d+)\s+document\(s\) restored/i.exec(stderr)
  return {
    ok: true,
    filePath,
    count: m ? Number(m[1]) : undefined,
    warning:
      'BSON archive restored to its original namespace — the selected target db/collection was not applied.'
  }
}

async function importNative(req: ImportRequest, filePath: string): Promise<DataOpResult> {
  let docs: Document[]
  if (req.format === 'json') {
    docs = parseJsonDocs(readFileSync(filePath, 'utf8'))
  } else {
    const wb = new ExcelJS.Workbook()
    if (req.format === 'csv') await wb.csv.readFile(filePath)
    else await wb.xlsx.readFile(filePath)
    const ws = wb.worksheets[0]
    docs = ws ? worksheetToDocs(ws) : []
  }
  if (!docs.length) return { ok: true, filePath, count: 0, warning: 'No rows found in the file.' }
  const { inserted, failures } = await insertDocs(req.connectionId, req.database, req.collection, docs)
  return {
    ok: true,
    filePath,
    count: inserted,
    warning: failures ? `${failures} document(s) were skipped (e.g. duplicate _id).` : undefined
  }
}

export async function importData(
  req: ImportRequest,
  win: BrowserWindow | null
): Promise<DataOpResult> {
  const openOpts = {
    properties: ['openFile' as const],
    filters: [OPEN_FILTERS[req.format]]
  }
  const picked = win ? await dialog.showOpenDialog(win, openOpts) : await dialog.showOpenDialog(openOpts)
  if (picked.canceled || picked.filePaths.length === 0) return { ok: false, cancelled: true }
  const filePath = picked.filePaths[0]
  try {
    return req.format === 'bson' ? await importBson(req, filePath) : await importNative(req, filePath)
  } catch (e) {
    return { ok: false, error: errMsg(e), filePath }
  }
}
