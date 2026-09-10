import { describe, expect, it } from 'vitest'
import { suggestShellRuntime } from '@renderer/lib/shellRuntimeSuggestion'

describe('suggestShellRuntime', () => {
  it('recognizes the official mongosh connection API', () => {
    expect(suggestShellRuntime('db.getMongo().startSession()', 'legacy')).toEqual({
      runtime: 'mongosh',
      construct: 'db.getMongo()'
    })
  })

  it.each([
    ['db.collection(name).find({})', 'db.collection()'],
    ['db.listCollections().toArray()', 'db.listCollections()'],
    ['db.items.indexes()', 'collection.indexes()'],
    ["db.getCollection('items').indexes()", 'collection.indexes()'],
    ['db.items.find({}).project({ name: 1 })', 'cursor.project()']
  ])('recognizes Legacy-only construct %s', (code, construct) => {
    expect(suggestShellRuntime(code, 'mongosh')).toEqual({ runtime: 'legacy', construct })
  })

  it('ignores comments, strings and unrelated object methods', () => {
    const code = `
      // db.getMongo()
      const note = 'db.collection(name)'
      custom.getMongo()
      custom.collection(name)
      custom.find({}).project({ name: 1 })
    `
    expect(suggestShellRuntime(code, 'legacy')).toBeNull()
    expect(suggestShellRuntime(code, 'mongosh')).toBeNull()
  })

  it('does not suggest the runtime already selected', () => {
    expect(suggestShellRuntime('db.getMongo()', 'mongosh')).toBeNull()
    expect(suggestShellRuntime('db.collection(name)', 'legacy')).toBeNull()
  })
})
