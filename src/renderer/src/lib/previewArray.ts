import type { CollectionSort } from '@shared/types'
import { isExtended } from './ejson'
import { cellValue, deriveColumns, isPlainObject } from './tableShape'

export interface PreviewArrayColumn {
  /** null identifies the array element itself, independently of field names. */
  field: string | null
  label: string
}

function isDocument(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value) && !isExtended(value)
}

export function previewArrayColumns(value: unknown[], sort: CollectionSort): PreviewArrayColumn[] {
  const documents = value.filter(isDocument)
  const fields = deriveColumns(documents, sort)
  const columns: PreviewArrayColumn[] = fields.map((field) => ({ field, label: field }))
  if (documents.length < value.length) {
    const names = new Set(fields)
    let label = '(value)'
    for (let suffix = 2; names.has(label); suffix++) label = `(value ${suffix})`
    columns.push({ field: null, label })
  }
  return columns
}

export function previewArrayCell(value: unknown, column: PreviewArrayColumn): { present: boolean; value: unknown } {
  const document = isDocument(value)
  if (column.field === null) return { present: !document, value: document ? undefined : value }
  return document ? cellValue(value, column.field) : { present: false, value: undefined }
}
