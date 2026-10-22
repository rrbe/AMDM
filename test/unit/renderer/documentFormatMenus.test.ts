import { describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/i18n', () => ({
  default: { t: (key: string) => key }
}))

import { jsonCopyMenuItems, resultExportMenuItem } from '@renderer/components/results/documentFormatMenus'

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

  it('opens export directly for the selected documents', () => {
    const exportDocuments = vi.fn()
    const documents = [{ name: 'Ada' }]
    const item = resultExportMenuItem(documents, exportDocuments)
    expect(item).toMatchObject({ label: 'result.dataMenu.export' })
    expect(item).not.toHaveProperty('children')
    if (item !== 'separator' && 'onClick' in item) item.onClick()
    expect(exportDocuments).toHaveBeenCalledWith('json', documents, 'plain')
  })
})
