import { describe, expect, it } from 'vitest'
import { selectDisplayFields } from '@renderer/lib/resultFields'
import { deriveTableColumnGroups } from '@renderer/lib/tableShape'
import { appendResult, createTab, patchResult, patchTab } from '@renderer/lib/tabs'
import { toPlainJson } from '@renderer/lib/resultCopy'

describe('result display fields', () => {
  it('retains the original results when all fields are displayed', () => {
    const docs = [{ _id: 1, name: 'Ada' }]
    expect(selectDisplayFields(docs, null)).toBe(docs)
  })

  it('hides fields without modifying the document used for copy and editing', () => {
    const nested = { city: 'Paris', postalCode: '75001' }
    const original = Object.freeze({ _id: 1, name: 'Ada', address: nested, private: true })
    const docs = [original]
    const shown = selectDisplayFields(docs, ['name', 'address'])
    expect(shown).toEqual([{ name: 'Ada', address: nested }])
    expect((shown[0] as typeof original).address).toBe(nested)
    expect(docs[0]).toBe(original)
    expect(JSON.parse(toPlainJson(docs))).toEqual([original])
    expect(deriveTableColumnGroups(shown, 'grouped').map((group) => group.key)).toEqual(['address', 'name'])
  })

  it('matches literal top-level keys and preserves nested arrays and BSON values', () => {
    const doc = JSON.parse('{"a.b":1,"a":{"b":2},"__proto__":3,"items":[{"a":1,"b":2}],"date":{"$date":{"$numberLong":"0"}}}')
    const shown = selectDisplayFields([doc], ['a.b', '__proto__', 'items', 'date'])[0]
    expect(shown).toEqual(Object.fromEntries(['a.b', '__proto__', 'items', 'date'].map((key) => [key, doc[key]])))
    expect(Object.getPrototypeOf(shown)).toBe(Object.prototype)
  })

  it('keeps document positions when fields are missing and never includes newly encountered fields', () => {
    expect(selectDisplayFields([{ name: 'Ada' }, { other: 2 }, {}], ['name'])).toEqual([{ name: 'Ada' }, {}, {}])
    expect(selectDisplayFields([{ newField: 1 }], ['name'])).toEqual([{}])
  })

  it('leaves scalar, array and BSON results intact', () => {
    const docs = [null, 42, 'hello', [1, 2], { $oid: '507f1f77bcf86cd799439011' }]
    expect(selectDisplayFields(docs, ['name'])).toEqual(docs)
  })

  it('keeps the selection through runs and paging, isolates query tabs and resets on a fresh tab', () => {
    let tab = createTab('one', { visibleFields: ['name'] })
    const other = createTab('two')
    const result = { kind: 'documents' as const, data: [{ name: 'Ada' }], count: 1, truncated: false }
    tab = { ...tab, ...appendResult(tab, 'result1', result, null) }
    tab = { ...tab, ...patchResult(tab, 'result1', { skip: 50, result: { ...result, data: [{ next: 1 }] } }) }
    tab = { ...tab, ...appendResult(tab, 'result2', result, null) }
    expect(tab.visibleFields).toEqual(['name'])
    const tabs = patchTab([tab, other], tab.id, { visibleFields: null })
    expect(tabs[0].visibleFields).toBeNull()
    expect(tabs[1]).toBe(other)
    expect(createTab('reopened').visibleFields).toBeNull()
  })
})
