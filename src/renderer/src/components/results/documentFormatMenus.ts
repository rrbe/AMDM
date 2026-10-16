import type { JsonEncoding } from '@shared/types'
import { Braces } from 'lucide-react'
import { createElement } from 'react'
import i18n from '@renderer/i18n'
import type { ContextMenuEntry } from '@renderer/components/ContextMenu'
import { toEncodedJsonArray, toEncodedJsonLines } from '@renderer/lib/resultCopy'

type CopyDocuments = (text: string) => void
const iconProps = { size: 16, strokeWidth: 1.8, 'aria-hidden': true } as const

const JSON_ENCODINGS = [
  {
    value: 'plain',
    labelKey: 'result.copy.plainJson',
    helpKey: 'io.encodingHelp.plain'
  },
  {
    value: 'relaxed',
    labelKey: 'result.copy.relaxedEjson',
    helpKey: 'io.encodingHelp.relaxed'
  },
  {
    value: 'canonical',
    labelKey: 'result.copy.canonicalEjson',
    helpKey: 'io.encodingHelp.canonical'
  }
] as const satisfies ReadonlyArray<{
  value: JsonEncoding
  labelKey: string
  helpKey: string
}>

export function jsonCopyMenuItems(documents: unknown[], copy: CopyDocuments): ContextMenuEntry[] {
  return [
    ...JSON_ENCODINGS.map(({ value, labelKey, helpKey }) => ({
      label: i18n.t(labelKey),
      icon: createElement(Braces, iconProps),
      description: i18n.t(helpKey),
      onClick: () => copy(toEncodedJsonArray(documents, value))
    })),
    {
      label: i18n.t('result.copy.jsonl'),
      icon: createElement(Braces, iconProps),
      description: i18n.t('io.layoutHelp.jsonl'),
      onClick: () => copy(toEncodedJsonLines(documents, 'plain'))
    }
  ]
}
