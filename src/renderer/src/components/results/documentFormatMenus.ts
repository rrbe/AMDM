import type { JsonEncoding, ResultExportFormat } from '@shared/types'
import { Braces, Download, SlidersHorizontal, Terminal } from 'lucide-react'
import { createElement } from 'react'
import i18n from '@renderer/i18n'
import type { ContextMenuEntry } from '@renderer/components/ContextMenu'
import { toEncodedJsonArray, toShellText } from '@renderer/lib/resultCopy'

type CopyDocuments = (text: string) => void
export type ExportDocuments = (format: ResultExportFormat, documents: unknown[], jsonEncoding?: JsonEncoding) => void

export function jsonCopyMenuItems(
  documents: unknown[],
  copy: CopyDocuments,
  openAdvanced: (documents: unknown[]) => void
): ContextMenuEntry[] {
  return [
    {
      label: i18n.t('result.copy.plainJson'),
      icon: createElement(Braces, { size: 16, strokeWidth: 1.8, 'aria-hidden': true }),
      onClick: () => copy(toEncodedJsonArray(documents, 'plain'))
    },
    {
      label: i18n.t('result.copy.advancedJson'),
      icon: createElement(SlidersHorizontal, { size: 16, strokeWidth: 1.8, 'aria-hidden': true }),
      onClick: () => openAdvanced(documents)
    },
    {
      label: i18n.t('result.copy.mongoShell'),
      icon: createElement(Terminal, { size: 16, strokeWidth: 1.8, 'aria-hidden': true }),
      onClick: () => copy(toShellText(documents.length === 1 ? documents[0] : documents))
    }
  ]
}

export function resultExportMenuItem(documents: unknown[], exportDocuments: ExportDocuments): ContextMenuEntry {
  return {
    label: i18n.t('result.dataMenu.export'),
    icon: createElement(Download, { size: 16, strokeWidth: 1.8, 'aria-hidden': true }),
    onClick: () => exportDocuments('json', documents, 'plain')
  }
}
