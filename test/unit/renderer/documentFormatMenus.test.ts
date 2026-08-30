import { describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/i18n', () => ({
  default: { t: (key: string) => key }
}))

import { jsonCopyMenuItems, resultExportMenuItems } from '@renderer/components/results/documentFormatMenus'

describe('document format menus', () => {
  it('groups JSON copy layouts under the encoding', () => {
    const copy = vi.fn()
    const items = jsonCopyMenuItems([{ name: 'Ada' }], copy)

    expect(items.map((item) => (item === 'separator' ? item : item.label))).toEqual([
      'result.copy.plainJson',
      'result.copy.relaxedEjson',
      'result.copy.canonicalEjson'
    ])
    expect(items[0] && items[0] !== 'separator' && 'children' in items[0] ? items[0].children : []).toMatchObject([
      { label: 'JSON Array', description: 'io.layoutHelp.array' },
      { label: 'JSONL / NDJSON', description: 'io.layoutHelp.jsonl' }
    ])
    const plainLayouts = items[0] && items[0] !== 'separator' && 'children' in items[0] ? items[0].children : []
    const jsonLines = plainLayouts[1]
    if (jsonLines !== 'separator' && jsonLines && 'onClick' in jsonLines) jsonLines.onClick()
    expect(copy).toHaveBeenCalledWith('{"name":"Ada"}')
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
