import { describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/i18n', () => ({
  default: { t: (key: string) => key }
}))

import { jsonCopyMenuItems, resultExportMenuItems } from '@renderer/components/results/documentFormatMenus'

describe('document format menus', () => {
  it('copies JSON directly and opens advanced formats without copying', () => {
    const copy = vi.fn()
    const documents = [{ name: 'Ada' }]
    const openAdvanced = vi.fn()
    const items = jsonCopyMenuItems(documents, copy, openAdvanced)

    expect(items.map((item) => (item === 'separator' ? item : item.label))).toEqual([
      'result.copy.plainJson',
      'result.copy.advancedJson',
      'result.copy.mongoShell'
    ])
    const plain = items[0]
    expect(plain).not.toHaveProperty('children')
    if (plain !== 'separator' && plain && 'onClick' in plain) plain.onClick()
    expect(copy).toHaveBeenCalledWith(JSON.stringify(documents, null, 2))
    const shell = items[2]
    expect(shell).not.toHaveProperty('children')
    if (shell !== 'separator' && shell && 'onClick' in shell) shell.onClick()
    expect(copy).toHaveBeenLastCalledWith('{\n  "name": "Ada"\n}')
    copy.mockClear()
    const advanced = items[1]
    expect(advanced).not.toHaveProperty('children')
    if (advanced !== 'separator' && advanced && 'onClick' in advanced) advanced.onClick()
    expect(openAdvanced).toHaveBeenCalledWith(documents)
    expect(copy).not.toHaveBeenCalled()
  })

  it('groups JSON export layouts under the encoding before other formats', () => {
    const exportDocuments = vi.fn()
    const items = resultExportMenuItems([], exportDocuments)

    expect(items.map((item) => (item === 'separator' ? item : item.label))).toEqual([
      'result.export.plainJson',
      'result.export.relaxedEjson',
      'result.export.canonicalEjson',
      'result.export.bson',
      'result.export.csv',
      'result.export.tsv',
      'result.export.xlsx'
    ])
    for (const item of items.slice(0, 3)) {
      expect(item !== 'separator' && 'children' in item ? item.children : []).toMatchObject([
        { label: 'JSON Array', description: 'io.layoutHelp.array' },
        { label: 'JSONL / NDJSON', description: 'io.layoutHelp.jsonl' }
      ])
    }
    const relaxed = items[1]
    const relaxedLayouts = relaxed !== 'separator' && relaxed && 'children' in relaxed ? relaxed.children : []
    const jsonArray = relaxedLayouts[0]
    if (jsonArray !== 'separator' && jsonArray && 'onClick' in jsonArray) jsonArray.onClick()
    expect(exportDocuments).toHaveBeenCalledWith('json', [], 'relaxed')
  })
})
