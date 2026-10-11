import { javascript } from '@codemirror/lang-javascript'
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import {
  shellSemanticTokens,
  shouldRefreshShellSemanticHighlight,
  type ShellSemanticKind
} from '@renderer/lib/shellSemanticHighlight'

function classified(code: string): Array<[string, ShellSemanticKind]> {
  const state = EditorState.create({ doc: code, extensions: [javascript()] })
  return shellSemanticTokens(state).map((token) => [state.sliceDoc(token.from, token.to), token.kind])
}

describe('shellSemanticTokens', () => {
  it('recognizes Shell objects and preserves ordinary JavaScript objects', () => {
    expect(classified('driverDb.collection("items").find(); rs.status(); sh.status()')).toEqual(
      expect.arrayContaining([['driverDb', 'db'], ['rs', 'db'], ['sh', 'db'], ['status', 'method']])
    )
    expect(classified('ordinary.find({ $gte: 1 }); const value = { field: 1 }')).toEqual([])
  })

  it('respects function arguments, block locals, and destructured bindings', () => {
    expect(classified('function f(db, ObjectId) { db.items.find(); ObjectId() }')).toEqual([])
    expect(classified('{ const { db } = source; db.items.find() }')).toEqual([])
    expect(classified('const db = other; db.items.find()')).toEqual([])
    expect(classified('function f(db) { db.items.find() } db.items.find()')).toEqual(
      [['db', 'db'], ['items', 'collection'], ['find', 'method']]
    )
  })

  it('does not mistake official database methods for collection names', () => {
    expect(classified('db.getMongo; db.getCollectionNames; db.help').filter(([, kind]) => kind === 'collection')).toEqual([])
  })

  it('colors standalone REPL commands but not strings, comments, or nested code', () => {
    expect(classified('use reporting')).toContainEqual(['use', 'command'])
    expect(classified('show collections')).toContainEqual(['show', 'command'])
    for (const code of ['// show collections', '/*\nuse reporting\n*/', '`\nshow collections\n`', 'function f() {\nshow collections\n}', 'show + other']) {
      expect(classified(code).filter(([, kind]) => kind === 'command')).toEqual([])
    }
  })

  it('supports incomplete input without classifying string contents', () => {
    expect(classified('db.items.find({ $gte:')).toContainEqual(['$gte', 'operator'])
    expect(classified('const text = "db.items')).toEqual([])
  })
  it('classifies a Mongo shell query by semantic role', () => {
    const tokens = classified(`db.unicorns.find({ dob: {
      $gte: new Date('1975-10-19'),
      $lt: ISODate('1977-10-20')
    } }).projection({ name: 1 }).sort({ _id: -1 }).limit(11)`)

    expect(tokens).toEqual(
      expect.arrayContaining([
        ['db', 'db'],
        ['unicorns', 'collection'],
        ['find', 'method'],
        ['dob', 'field'],
        ['$gte', 'operator'],
        ['$lt', 'operator'],
        ['Date', 'constructor'],
        ['ISODate', 'constructor'],
        ['projection', 'method'],
        ['sort', 'method'],
        ['limit', 'method']
      ])
    )
  })

  it('handles bracket collection access and quoted operator keys', () => {
    expect(classified(`db['audit-events'].find({ '$exists': true })`)).toEqual(
      expect.arrayContaining([
        ['db', 'db'],
        ["'audit-events'", 'collection'],
        ['find', 'method'],
        ["'$exists'", 'operator']
      ])
    )
  })

  it('does not classify Mongo-looking text inside values or comments', () => {
    const tokens = classified(`const note = '$gte db.users' // db.fake.find()`)
    expect(tokens).toEqual([])
  })

  it('refreshes decorations when the background parser replaces the syntax tree', () => {
    const startState = EditorState.create({ doc: 'db.users.find({})', extensions: [javascript()] })
    const state = EditorState.create({ doc: 'db.users.find({})', extensions: [javascript()] })

    expect(
      shouldRefreshShellSemanticHighlight({
        docChanged: false,
        viewportChanged: false,
        startState,
        state
      })
    ).toBe(true)
    expect(
      shouldRefreshShellSemanticHighlight({
        docChanged: false,
        viewportChanged: false,
        startState,
        state: startState
      })
    ).toBe(false)
  })
})
