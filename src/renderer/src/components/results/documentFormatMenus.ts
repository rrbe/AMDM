import type { JsonEncoding, ResultExportFormat } from '@shared/types'
import i18n from '@renderer/i18n'
import type { ContextMenuEntry } from '@renderer/components/ContextMenu'
import { toEncodedJsonArray, toEncodedJsonLines } from '@renderer/lib/resultCopy'

type CopyDocuments = (text: string) => void
export type ExportDocuments = (format: ResultExportFormat, documents: unknown[], jsonEncoding?: JsonEncoding) => void

function encodingEntries(select: (encoding: JsonEncoding) => void): ContextMenuEntry[] {
  return [
    { label: 'Plain JSON', description: i18n.t('io.encodingHelp.plain'), onClick: () => select('plain') },
    { label: 'Relaxed EJSON', description: i18n.t('io.encodingHelp.relaxed'), onClick: () => select('relaxed') },
    {
      label: 'Canonical EJSON',
      description: i18n.t('io.encodingHelp.canonical'),
      onClick: () => select('canonical')
    }
  ]
}

export function jsonCopyMenuItems(documents: unknown[], copy: CopyDocuments): ContextMenuEntry[] {
  return [
    {
      label: i18n.t('result.copy.jsonArray'),
      children: encodingEntries((encoding) => copy(toEncodedJsonArray(documents, encoding)))
    },
    {
      label: i18n.t('result.copy.jsonLines'),
      children: encodingEntries((encoding) => copy(toEncodedJsonLines(documents, encoding)))
    }
  ]
}

export function resultExportMenuItems(documents: unknown[], exportDocuments: ExportDocuments): ContextMenuEntry[] {
  return [
    {
      label: i18n.t('result.export.jsonArray'),
      children: encodingEntries((encoding) => exportDocuments('json', documents, encoding))
    },
    {
      label: i18n.t('result.export.jsonLines'),
      children: encodingEntries((encoding) => exportDocuments('jsonl', documents, encoding))
    },
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
