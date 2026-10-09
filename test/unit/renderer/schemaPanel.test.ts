import { describe, expect, it } from 'vitest'
import { analyzeSchemaDocuments } from '../../../src/main/workers/schema-analysis-core'
import { createTab } from '../../../src/renderer/src/lib/tabs'
import {
  buildSchemaTree,
  MAX_SCHEMA_PANELS,
  patchSchemaPanel,
  releaseSchemaPanels,
  schemaPanelKey,
  schemaPanelTarget,
  schemaNodeLabel,
  visibleSchemaRows,
  type SchemaPanelState
} from '../../../src/renderer/src/lib/schemaPanel'

describe('Schema sidebar fields', () => {
  it('labels nested object and array branches without changing real field names', async () => {
    const analysis = await analyzeSchemaDocuments([{ Document: 'actual field', Array: 1, items: [[{ value: 1 }]] }])
    const tree = buildSchemaTree(analysis.fields)
    expect(schemaNodeLabel(tree.find((row) => row.name === 'Document')!)).toBe('Document')
    expect(schemaNodeLabel(tree.find((row) => row.name === 'Array')!)).toBe('Array')
    const array = tree.find((row) => row.name === 'items')!.children[0]
    expect(schemaNodeLabel(array)).toBe('[...]')
    const object = array.children[0]
    expect(schemaNodeLabel(object)).toBe('{...}')
    expect(schemaNodeLabel(object.children[0])).toBe('value')
  })
  it('keeps missing fields separate from Null and uses parent/element proportions', async () => {
    const analysis = await analyzeSchemaDocuments([
      { optional: null, profile: { name: 'a' }, items: [{ code: 'a' }, 'b'] },
      { profile: {}, items: [{ code: 'c' }] },
      { optional: 'present' }
    ])
    const tree = buildSchemaTree(analysis.fields)
    const optional = tree.find((row) => row.name === 'optional')!
    expect(optional.probability).toBeCloseTo(2 / 3)
    expect(optional.types.map((type) => type.bsonType).sort()).toEqual(['Null', 'String'])
    const name = tree.find((row) => row.name === 'profile')!.children[0]
    expect(name).toMatchObject({
      path: 'profile.name',
      scope: 'objects',
      count: 1,
      probability: 0.5
    })
    const item = tree.find((row) => row.name === 'items')!.children.find((row) => row.types[0].bsonType === 'Document')!
    expect(item.scope).toBe('elements')
    expect(item.probability).toBeCloseTo(2 / 3)
    expect(item.children[0]).toMatchObject({
      path: 'items[].code',
      scope: 'objects',
      probability: 1
    })
  })

  it('reveals nested search matches and restores manual expansion after clearing search', async () => {
    const analysis = await analyzeSchemaDocuments([{ profile: { name: 'a', age: 1 }, other: true }])
    const tree = buildSchemaTree(analysis.fields)
    const expanded = new Set<string>()
    expect(visibleSchemaRows(tree, expanded, '').map((row) => row.name)).toEqual(['other', 'profile'])
    expect(visibleSchemaRows(tree, expanded, 'name').map((row) => row.name)).toEqual(['profile', 'name'])
    expect(expanded.size).toBe(0)
    expect(visibleSchemaRows(tree, expanded, 'not found')).toEqual([])
    expanded.add(tree.find((row) => row.name === 'profile')!.id)
    expect(visibleSchemaRows(tree, expanded, '').map((row) => row.name)).toEqual(['other', 'profile', 'age', 'name'])
  })

  it('keeps mixed objects and arrays in separate branches', async () => {
    const analysis = await analyzeSchemaDocuments([{ mixed: { value: 1 } }, { mixed: [{ value: 'two' }] }])
    const mixed = buildSchemaTree(analysis.fields)[0]
    expect(mixed.children.map((row) => row.id)).toHaveLength(2)
    expect(new Set(mixed.children.map((row) => row.id)).size).toBe(2)
    expect(mixed.children.find((row) => row.name === 'Document')).toMatchObject({
      scope: 'documents',
      probability: 0.5
    })
  })
})

describe('Schema sidebar namespace and lifecycle', () => {
  const target = { connectionId: 'c1', database: 'shop', collection: 'orders' }

  it('follows one editor namespace and ignores comments, quoted text and DB methods', () => {
    const tab = createTab('t1', { connectionId: 'c1', activeDatabase: 'shop' })
    for (const code of ['db.orders.find({})', 'db.getCollection("orders").find({})', 'db["orders"].find({})']) {
      expect(schemaPanelTarget({ ...tab, code })).toEqual(target)
    }
    expect(
      schemaPanelTarget({
        ...tab,
        code: '// db.other.find()\ndb.orders.find({text: "db.other"})'
      })
    ).toEqual(target)
    expect(schemaPanelTarget({ ...tab, code: 'db.orders.find(); db.other.find()' })).toBeNull()
    expect(schemaPanelTarget({ ...tab, code: 'db.getName()' })).toBeNull()
    expect(
      schemaPanelTarget({
        ...tab,
        code: 'db.getSiblingDB("elsewhere").orders.find()'
      })
    ).toBeNull()
    expect(schemaPanelTarget({ ...tab, code: 'print("db.orders.find()")' })).toBeNull()
  })

  it('bounds collection state, retains recently used entries, and releases only one connection', () => {
    let panels: Record<string, SchemaPanelState> = {}
    for (let i = 0; i < MAX_SCHEMA_PANELS; i++)
      panels = patchSchemaPanel(panels, { ...target, collection: `c${i}` }, {})
    const first = { ...target, collection: 'c0' }
    panels = patchSchemaPanel(panels, first, {
      search: 'name',
      expanded: new Set(['profile']),
      scrollTop: 500
    })
    const owner = panels[schemaPanelKey(first)].owner
    panels = patchSchemaPanel(panels, { ...target, connectionId: 'c2' }, {})
    expect(Object.keys(panels)).toHaveLength(MAX_SCHEMA_PANELS)
    expect(panels[schemaPanelKey({ ...target, collection: 'c1' })]).toBeUndefined()
    expect(panels[schemaPanelKey(first)]).toMatchObject({
      search: 'name',
      scrollTop: 500,
      owner
    })
    expect(Object.keys(releaseSchemaPanels(panels, 'c1'))).toEqual([schemaPanelKey({ ...target, connectionId: 'c2' })])
  })
})
