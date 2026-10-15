import { beforeEach, describe, expect, it } from 'vitest'
import { buildCollectionDecls } from '@renderer/lib/tsAutocomplete/mongoBaseDts'
import { complete, diagnose, setFile } from '@renderer/lib/tsAutocomplete/tsService'

const context = { database: 'app', collections: ['users', 'orders', 'system.views'] }
const errors = (code: string) => diagnose(code, context).filter((item) => item.severity === 'error')
const warnings = (code: string) =>
  diagnose(code, context).filter((item) => item.severity === 'warning')

beforeEach(() => setFile('/decls.d.ts', buildCollectionDecls(context.collections)))

describe('Query syntax and method diagnostics', () => {
  it.each([
    ['db.users.fidn({})', 'fidn'],
    ['db.users.find().srot({ name: 1 })', 'srot'],
    ['const cursor = db.users.find(); cursor.limt(10)', 'limt'],
    ['const collection = db.users; collection.fidn()', 'fidn'],
    ['db.getCollection("users").fidn()', 'fidn'],
    ['db.getSiblingDB("other").users.fidn()', 'fidn'],
    ['driverDb.collection("users").fidn()', 'fidn'],
    ['db.getMongo().startSession().withTransacton(() => {})', 'withTransacton'],
    ['db.fidn({})', 'fidn'],
    ['db.users.find({ name: missingVariable })', 'missingVariable']
  ])('marks the offending token in %s', (code, token) => {
    expect(errors(code).map((item) => code.slice(item.from, item.to))).toContain(token)
  })

  it.each([
    'db.users.find({', 'db.users.find({ name: })', 'const = 1', 'const missing;',
    'const value = 1; const value = 2', 'const value = 1; value = 2', 'break;', 'return 1;'
  ])(
    'reports syntax errors in %s',
    (code) => {
      expect(errors(code).length).toBeGreaterThan(0)
      for (const item of errors(code)) {
        expect(item.from).toBeGreaterThanOrEqual(0)
        expect(item.to).toBeLessThanOrEqual(code.length)
        expect(item.to).toBeGreaterThan(item.from)
      }
    }
  )

  it.each([
    'await db.users.find({ name: "Ada", $expr: { $gte: ["$age", 18] } }).sort({ name: 1 }).limit(10).toArray()',
    'db.getCollection("system.views").find({})',
    'db.getMongo().startSession().withTransaction(async () => {})',
    'ObjectId(); ISODate(); NumberLong("1"); print("hello"); printjson({}); sleep(10)',
    'let value = 1; value = "text"; const doc = await db.users.findOne({}); doc.name',
    'const db = { users: { custom() {} } }; db.users.custom()',
    'db.users.insertOne({ name: "Ada" })',
    'const value = { n: 1, n: 2 }; db.users.find({ n: 1, n: 2 })',
    'const source = "db.users.fidn()"; // db.users.fidn()\n/* db.users.fidn() */',
    'const pattern = /db\.users\.fidn/; const text = `db.users.fidn()`'
  ])('accepts valid JavaScript and Mongosh: %s', (code) => {
    expect(errors(code)).toEqual([])
  })

  it('clears errors after correction and preserves official completions', () => {
    expect(errors('db.users.fidn()')).toHaveLength(1)
    expect(diagnose('db.users.find({})', context)).toEqual([])
    const code = 'db.users.find().'
    expect(complete(code, code.length).entries.map((item) => item.name)).toContain('projection')
  })

  it('bounds the number of problems without evaluating query code', () => {
    expect(diagnose('throw new Error("must not execute"); db.users.fidn()', context)).toHaveLength(
      1
    )
    expect(
      diagnose(Array.from({ length: 300 }, (_, i) => `missing${i}();`).join('\n'), context)
    ).toHaveLength(100)
  })
})

describe('Collection catalog diagnostics', () => {
  it.each([
    ['db.usres.find()', 'usres'],
    ['db["usres"].find()', '"usres"'],
    ['db.getCollection("system.viwes").find()', '"system.viwes"'],
    ['driverDb.collection("usres").find()', '"usres"']
  ])('warns on the collection token in %s', (code, token) => {
    const problems = warnings(code)
    expect(problems).toHaveLength(1)
    expect(code.slice(problems[0].from, problems[0].to)).toBe(token)
    expect(problems[0].collectionName).toBeDefined()
  })

  it('distinguishes an unloaded catalog from an empty database', () => {
    expect(diagnose('db.usres.find()', { database: 'app', collections: null })).toEqual([])
    expect(diagnose('db.usres.find()', { database: 'app', collections: [] })).toMatchObject([
      { severity: 'warning', collectionName: 'usres' }
    ])
  })

  it('still checks methods when no catalog is available', () => {
    expect(diagnose('db.usres.fidn()', { database: 'app', collections: null })).toMatchObject([
      { severity: 'error', message: expect.stringContaining('fidn') }
    ])
  })

  it('refreshes warnings when the connection/database catalog changes', () => {
    const code = 'db.users.find()'
    expect(diagnose(code, context)).toEqual([])
    expect(diagnose(code, { database: 'other', collections: ['orders'] })).toMatchObject([
      { severity: 'warning', collectionName: 'users' }
    ])
    expect(diagnose(code, context)).toEqual([])
  })

  it.each([
    'db.stats(); db.getName(); db.users.find(); db.getCollection("system.views").find()',
    'const db = { usres: {} }; db.usres',
    'function query(db) { return db.usres.find() }',
    'const source = {}; const { db } = source; db.usres.find()',
    'const source = {}; const { db: db } = source; db.usres.find()',
    'const driverDb = { collection(name) { return {} } }; driverDb.collection("missing")',
    'db.getSiblingDB("other").missing.find()',
    'const collection = "users"; db.getCollection(collection).find()',
    '"db.usres.find()"; // db.usres.find()\n/* db.usres.find() */',
    'db.fidn()'
  ])('avoids catalog warnings for %s', (code) => {
    expect(warnings(code)).toEqual([])
  })

  it('keeps new collection writes as warnings, rather than errors', () => {
    expect(diagnose('db.newCollection.insertOne({ name: "Ada" })', context)).toMatchObject([
      { severity: 'warning', collectionName: 'newCollection' }
    ])
  })
})

describe('Mongosh command syntax', () => {
  it.each([
    'show dbs',
    'show collections;',
    'show databases\r\nshow tables',
    'show users\nshow roles\nshow profile\nshow logs\nshow log global',
    'use app\ndb.users.find()',
    'const text = `\nshow dbs\nuse other\n`; db.users.find()',
    '/*\nshow dbs\nuse other\n*/ db.users.find()'
  ])('handles %s without false syntax errors', (code) => {
    expect(diagnose(code, context)).toEqual([])
  })

  it('keeps error ranges after command lines', () => {
    const code = 'show dbs\r\nuse app\r\ndb.users.fidn()'
    expect(errors(code)).toHaveLength(1)
    expect(code.slice(errors(code)[0].from, errors(code)[0].to)).toBe('fidn')
  })

  it('does not use the selected database catalog after switching databases in a script', () => {
    const code = 'use other\ndb.somewhereElse.find()\nuse app\ndb.usres.find()'
    expect(diagnose(code, context)).toMatchObject([
      { severity: 'warning', collectionName: 'usres' }
    ])
  })

  it('does not mask invalid commands or commands inside JS blocks', () => {
    expect(errors('show notACommand').length).toBeGreaterThan(0)
    expect(errors('if (true) {\nshow dbs\n}').length).toBeGreaterThan(0)
  })
})
