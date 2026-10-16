import { describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/i18n', () => ({
  default: { t: (key: string) => key }
}))

import { jsonCopyMenuItems } from '@renderer/components/results/documentFormatMenus'

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

  it.each([
    [0, [{ _id: '64b7f0f0f0f0f0f0f0f0f0f0', count: 42 }]],
    [1, [{ _id: { $oid: '64b7f0f0f0f0f0f0f0f0f0f0' }, count: 42 }]],
    [2, [{ _id: { $oid: '64b7f0f0f0f0f0f0f0f0f0f0' }, count: { $numberLong: '42' } }]]
  ])('copies the BSON representation chosen by action %i', (index, expected) => {
    const copy = vi.fn()
    const documents = [{ _id: { $oid: '64b7f0f0f0f0f0f0f0f0f0f0' }, count: { $numberLong: '42' } }]
    const item = jsonCopyMenuItems(documents, copy)[index as number]

    expect(item).toHaveProperty('onClick')
    if (item === 'separator' || !item || !('onClick' in item)) throw new Error('Expected copy action')
    item.onClick()
    expect(JSON.parse(copy.mock.calls[0][0])).toEqual(expected)
  })
})
