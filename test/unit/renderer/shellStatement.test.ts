import { javascript } from '@codemirror/lang-javascript'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { shellStatementAt } from '@renderer/lib/shellStatement'

function stateAt(doc: string, marker: string, offset = 0): EditorState {
  const pos = doc.indexOf(marker)
  if (pos < 0) throw new Error(`Marker not found: ${marker}`)
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(pos + offset),
    extensions: [javascript()]
  })
}

describe('shellStatementAt', () => {
  it('识别完整的多行查询调用链', () => {
    const query = `db.address.find({
  id: "123"
})
  .sort({_id:-1})
  .skip(0)
  .limit(100)`
    const state = stateAt(`${query}\n\ndb.users.find({})`, '.sort')

    expect(shellStatementAt(state)).toMatchObject({
      from: 0,
      to: query.length,
      code: query,
      firstLineFrom: 0
    })
  })

  it('只返回光标所在的顶层语句', () => {
    const first = 'db.orders.find({ paid: true });'
    const second = 'db.users.find({ active: true }).limit(20)'
    const doc = `${first}\n${second}`

    expect(shellStatementAt(stateAt(doc, 'users'))?.code).toBe(second)
  })

  it('支持包含嵌套表达式与注释的 aggregate', () => {
    const aggregate = `db.orders.aggregate([
  { $match: { status: { $in: ["paid", "sent"] } } },
  // Return the newest orders first.
  { $sort: { createdAt: -1 } }
])`

    expect(shellStatementAt(stateAt(aggregate, '$sort'))?.code).toBe(aggregate)
  })

  it('把没有空行分隔的连续前导注释归入语句', () => {
    const doc = `// orders
/* only recent */
db.orders.find({}).limit(10)`

    expect(shellStatementAt(stateAt(doc, 'only recent'))?.code).toBe(doc)
    expect(shellStatementAt(stateAt(doc, 'orders.find'))?.code).toBe(doc)
  })

  it('不跨越空行归并注释', () => {
    const doc = `// detached

db.orders.find({})`

    expect(shellStatementAt(stateAt(doc, 'detached'))).toBeUndefined()
    expect(shellStatementAt(stateAt(doc, 'orders.find'))?.code).toBe('db.orders.find({})')
  })

  it('把同一行的尾随注释留给前一个语句', () => {
    const first = 'db.orders.find({})'
    const doc = `${first} // trailing
db.users.find({})`

    expect(shellStatementAt(stateAt(doc, 'trailing'))?.code).toBe(first)
    expect(shellStatementAt(stateAt(doc, 'users.find'))?.code).toBe('db.users.find({})')
  })

  it('光标位于语句之间的空白行时不返回语句', () => {
    const doc = `db.orders.find({})

db.users.find({})`
    const state = EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.indexOf('\n\n') + 1),
      extensions: [javascript()]
    })

    expect(shellStatementAt(state)).toBeUndefined()
  })

  it('语句包含恢复错误节点时不返回可能吞并相邻查询的范围', () => {
    const doc = `db.orders.find({})
  .sort({

db.users.find({})`

    expect(shellStatementAt(stateAt(doc, 'orders'))).toBeUndefined()
    expect(shellStatementAt(stateAt(doc, 'users'))).toBeUndefined()
  })

  it('后续语句有语法错误时仍返回前一个完整语句', () => {
    const first = 'db.orders.find({})'
    const doc = `${first}\ndb.users.find({`

    expect(shellStatementAt(stateAt(doc, 'orders'))?.code).toBe(first)
  })

  it('使用选区活动端所在的语句定位', () => {
    const first = 'db.orders.find({})'
    const second = 'db.users.find({})'
    const doc = `${first}\n${second}`
    const state = EditorState.create({
      doc,
      selection: EditorSelection.range(0, doc.indexOf('users') + 2),
      extensions: [javascript()]
    })

    expect(shellStatementAt(state)?.code).toBe(second)
  })
})
