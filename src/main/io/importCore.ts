import { extname } from 'node:path'
import { EJSON } from 'bson'
import type { Document } from 'mongodb'

export type ImportFileFormat = 'json' | 'csv' | 'tsv' | 'xlsx' | 'bson'

function asDocument(value: unknown): Document {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('JSON import requires document objects.')
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error('JSON import requires document objects.')
  }
  return value as Document
}

/** Parse one document, a JSON array, or JSONL/NDJSON while preserving canonical EJSON types. */
export function parseJsonDocuments(content: string): Document[] {
  const trimmed = content.trim()
  if (!trimmed) return []

  try {
    const parsed = EJSON.parse(trimmed, { relaxed: false }) as unknown
    return Array.isArray(parsed) ? parsed.map(asDocument) : [asDocument(parsed)]
  } catch (wholeFileError) {
    const lines = trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    if (lines.length <= 1) throw wholeFileError
    return lines.map((line) => asDocument(EJSON.parse(line, { relaxed: false }) as unknown))
  }
}

/** Detect the importer from the selected file name; JSON encoding is detected by EJSON.parse. */
export function detectImportFileFormat(filePath: string): ImportFileFormat {
  const lowerPath = filePath.toLowerCase()
  if (lowerPath.endsWith('.bson.gz') || lowerPath.endsWith('.bson')) return 'bson'
  const extension = extname(lowerPath)
  if (extension === '.json' || extension === '.jsonl' || extension === '.ndjson') return 'json'
  if (extension === '.csv') return 'csv'
  if (extension === '.tsv') return 'tsv'
  if (extension === '.xlsx') return 'xlsx'
  throw new Error(`Unsupported import file type: ${extension || '(none)'}`)
}
