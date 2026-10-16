import { describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/i18n', () => ({
  default: { t: (key: string) => key }
}))

import { jsonCopyMenuItems, resultExportMenuItems } from '@renderer/components/results/documentFormatMenus'

describe('document format menus', () => {
  it('copies JSON encodings and JSONL directly from one submenu level', () => {
    const copy = vi.fn()
    const items = jsonCopyMenuItems([{ name: 'Ada' }, { name: 'Grace' }], copy)

    expect(items.map((item) => (item === 'separator' ? item : item.label))).toEqual([
      'result.copy.plainJson',
      'result.copy.relaxedEjson',
      'result.copy.canonicalEjson',
      'result.copy.jsonl'
    ])
    const jsonLines = items[3]
    if (jsonLines !== 'separator' && jsonLines && 'onClick' in jsonLines) jsonLines.onClick()
    expect(copy).toHaveBeenCalledWith('{"name":"Ada"}\n{"name":"Grace"}')
  })

  it('offers export presets and a separate route to the full export options', () => {
    const exportDocuments = vi.fn()
    const items = resultExportMenuItems([], exportDocuments)

    expect(items.map((item) => (item === 'separator' ? item : item.label))).toEqual([
      'result.export.plainJson',
      'result.export.relaxedEjson',
      'result.export.canonicalEjson',
      'separator',
      'result.export.jsonl',
      'result.export.bson',
      'result.export.csv',
      'result.export.tsv',
      'result.export.xlsx',
      'separator',
      'result.export.moreOptions'
    ])
    const relaxed = items[1]
    if (relaxed !== 'separator' && relaxed && 'onClick' in relaxed) relaxed.onClick()
    expect(exportDocuments).toHaveBeenCalledWith('json', [], 'relaxed')
    const jsonLines = items[4]
    if (jsonLines !== 'separator' && jsonLines && 'onClick' in jsonLines) jsonLines.onClick()
    expect(exportDocuments).toHaveBeenCalledWith('jsonl', [], 'plain')
    const moreOptions = items[10]
    if (moreOptions !== 'separator' && moreOptions && 'onClick' in moreOptions) moreOptions.onClick()
    expect(exportDocuments).toHaveBeenCalledWith(null, [])
  })
})
