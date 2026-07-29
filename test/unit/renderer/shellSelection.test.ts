import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { selectionCode } from '@renderer/lib/shellSelection'

describe('selectionCode', () => {
  it('只返回选中查询，忽略未选中的非法代码并保留注释', () => {
    const query = `db.orders.aggregate([
  { $limit: 1 },
  // sdfsdf
  { $match: { active: true } },
]);`
    const doc = `random junk\n\n${query}\n\nother invalid text`
    const from = doc.indexOf(query)
    const state = EditorState.create({
      doc,
      selection: EditorSelection.range(from, from + query.length)
    })

    expect(selectionCode(state)).toBe(query)
  })

  it('没有选区时返回 undefined，由调用方执行全文', () => {
    expect(selectionCode(EditorState.create({ doc: 'db.orders.find({})' }))).toBeUndefined()
  })
})
