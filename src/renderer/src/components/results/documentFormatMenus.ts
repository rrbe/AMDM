import type { JsonEncoding, ResultExportFormat } from '@shared/types'
import { Braces, Database, FileSpreadsheet, Table2 } from 'lucide-react'
import { createElement } from 'react'
import i18n from '@renderer/i18n'
import type { ContextMenuEntry } from '@renderer/components/ContextMenu'
import { toEncodedJsonArray, toEncodedJsonLines } from '@renderer/lib/resultCopy'

type CopyDocuments = (text: string) => void
export type ExportDocuments = (
  format: ResultExportFormat | null,
  documents: unknown[],
  jsonEncoding?: JsonEncoding
) => void

const iconProps = { size: 16, strokeWidth: 1.8, 'aria-hidden': true } as const

const JSON_ENCODINGS = [
  { value: 'plain', helpKey: 'io.encodingHelp.plain' },
  { value: 'relaxed', helpKey: 'io.encodingHelp.relaxed' },
  { value: 'canonical', helpKey: 'io.encodingHelp.canonical' }
] as const satisfies ReadonlyArray<{ value: JsonEncoding; helpKey: string }>

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

function encodingEntries(scope: 'copy' | 'export', select: (encoding: JsonEncoding) => void): ContextMenuEntry[] {
  return JSON_ENCODINGS.map(({ value, helpKey }) => ({
    label: encodingLabel(scope, value),
    icon: createElement(Braces, iconProps),
    description: i18n.t(helpKey),
    onClick: () => select(value)
  }))
}

export function jsonCopyMenuItems(documents: unknown[], copy: CopyDocuments): ContextMenuEntry[] {
  return [
    ...encodingEntries('copy', (encoding) => copy(toEncodedJsonArray(documents, encoding))),
    {
      label: i18n.t('result.copy.jsonl'),
      icon: createElement(Braces, iconProps),
      description: i18n.t('io.layoutHelp.jsonl'),
      onClick: () => copy(toEncodedJsonLines(documents, 'plain'))
    }
  ]
}

export function resultExportMenuItems(documents: unknown[], exportDocuments: ExportDocuments): ContextMenuEntry[] {
  return [
    ...encodingEntries('export', (encoding) => exportDocuments('json', documents, encoding)),
    'separator',
    {
      label: i18n.t('result.export.jsonl'),
      icon: createElement(Braces, iconProps),
      description: i18n.t('io.layoutHelp.jsonl'),
      onClick: () => exportDocuments('jsonl', documents, 'plain')
    },
    {
      label: i18n.t('result.export.bson'),
      icon: createElement(Database, iconProps),
      onClick: () => exportDocuments('bson', documents)
    },
    {
      label: i18n.t('result.export.csv'),
      icon: createElement(Table2, iconProps),
      onClick: () => exportDocuments('csv', documents)
    },
    {
      label: i18n.t('result.export.tsv'),
      icon: createElement(Table2, iconProps),
      onClick: () => exportDocuments('tsv', documents)
    },
    {
      label: i18n.t('result.export.xlsx'),
      icon: createElement(FileSpreadsheet, iconProps),
      onClick: () => exportDocuments('xlsx', documents)
    },
    'separator',
    {
      label: i18n.t('result.export.moreOptions'),
      onClick: () => exportDocuments(null, documents)
    }
  ]
}
