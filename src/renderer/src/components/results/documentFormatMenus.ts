import type { JsonEncoding, ResultExportFormat } from '@shared/types'
import i18n from '@renderer/i18n'
import type { ContextMenuEntry } from '@renderer/components/ContextMenu'
import { toEncodedJsonArray, toEncodedJsonLines } from '@renderer/lib/resultCopy'

type CopyDocuments = (text: string) => void
export type ExportDocuments = (format: ResultExportFormat, documents: unknown[], jsonEncoding?: JsonEncoding) => void

const JSON_ENCODINGS = [
  { value: 'plain', helpKey: 'io.encodingHelp.plain' },
  { value: 'relaxed', helpKey: 'io.encodingHelp.relaxed' },
  { value: 'canonical', helpKey: 'io.encodingHelp.canonical' }
] as const satisfies ReadonlyArray<{ value: JsonEncoding; helpKey: string }>

function layoutEntries(select: (format: 'json' | 'jsonl') => void): ContextMenuEntry[] {
  return [
    {
      label: 'JSON Array',
      description: i18n.t('io.layoutHelp.array'),
      onClick: () => select('json')
    },
    {
      label: 'JSONL / NDJSON',
      description: i18n.t('io.layoutHelp.jsonl'),
      onClick: () => select('jsonl')
    }
  ]
}

function encodingLabel(scope: 'copy' | 'export', encoding: JsonEncoding): string {
  if (scope === 'copy') {
    if (encoding === 'plain') return i18n.t('result.copy.plainJson')
    if (encoding === 'relaxed') return i18n.t('result.copy.relaxedEjson')
    return i18n.t('result.copy.canonicalEjson')
  }
  if (encoding === 'plain') return i18n.t('result.export.plainJson')
  if (encoding === 'relaxed') return i18n.t('result.export.relaxedEjson')
  return i18n.t('result.export.canonicalEjson')
}

function encodingEntries(
  scope: 'copy' | 'export',
  select: (encoding: JsonEncoding, format: 'json' | 'jsonl') => void
): ContextMenuEntry[] {
  return JSON_ENCODINGS.map(({ value, helpKey }) => ({
    label: encodingLabel(scope, value),
    description: i18n.t(helpKey),
    children: layoutEntries((format) => select(value, format))
  }))
}

export function jsonCopyMenuItems(documents: unknown[], copy: CopyDocuments): ContextMenuEntry[] {
  return encodingEntries('copy', (encoding, format) =>
    copy(format === 'json' ? toEncodedJsonArray(documents, encoding) : toEncodedJsonLines(documents, encoding))
  )
}

export function resultExportMenuItems(documents: unknown[], exportDocuments: ExportDocuments): ContextMenuEntry[] {
  return [
    ...encodingEntries('export', (encoding, format) => exportDocuments(format, documents, encoding)),
    {
      label: i18n.t('result.export.bson'),
      onClick: () => exportDocuments('bson', documents)
    },
    {
      label: i18n.t('result.export.csv'),
      onClick: () => exportDocuments('csv', documents)
    },
    {
      label: i18n.t('result.export.tsv'),
      onClick: () => exportDocuments('tsv', documents)
    },
    {
      label: i18n.t('result.export.xlsx'),
      onClick: () => exportDocuments('xlsx', documents)
    }
  ]
}
