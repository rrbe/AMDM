import { describe, it, expect } from 'vitest'
import { detectCollection, prepareShellInput } from '../../../src/main/mongo/shellSupport'

describe('detectCollection', () => {
  it('detects dotted access', () => {
    expect(detectCollection('db.users.find({})')).toBe('users')
    expect(detectCollection('db.lives.aggregate([])')).toBe('lives')
  })
  it('detects getCollection and bracket access (allowing dots/dashes in the name)', () => {
    expect(detectCollection("db.getCollection('my-coll').find()")).toBe('my-coll')
    expect(detectCollection("db['weird.name'].countDocuments()")).toBe('weird.name')
  })
  it('ignores db-level methods (not collection names)', () => {
    expect(detectCollection('db.runCommand({ ping: 1 })')).toBeUndefined()
    expect(detectCollection('db.getCollectionNames()')).toBeUndefined()
    expect(detectCollection('db.aggregate([])')).toBeUndefined()
    expect(detectCollection('db.stats()')).toBeUndefined()
  })
  it('returns undefined when no collection is referenced', () => {
    expect(detectCollection('const x = 1')).toBeUndefined()
  })
})

describe('prepareShellInput', () => {
  it('preserves ordinary scripts and wraps explicit await with its completion value', () => {
    expect(prepareShellInput('db.items.find()', 'test').code).toBe('db.items.find()')
    expect(prepareShellInput('await Promise.resolve(42)', 'test').code).toContain('return (await Promise.resolve(42))')
  })

  it.each([
    ["db.getCollection('a.b').find({}).sort({n:1}).skip(1).limit(2).toArray()", 'test', 'a.b'],
    ["await db.getSiblingDB('other')['records'].findOne({}, { name: 1 })", 'other', 'records'],
    ["driverDb.collection('items').find({}, { projection: { secret: false } }).next()", 'test', 'items'],
  ])('recognizes a direct document read in %s', (code, database, collection) => {
    expect(prepareShellInput(code, 'test').documentSource).toEqual({ database, collection })
  })

  it.each([
    'db.items.aggregate([{ $group: { _id: "$bucket" } }])',
    'db.items.find().map(doc => ({ _id: doc.other }))',
    'db.items.find({}, { _id: "$other" })',
    'db.items.find({}, { name: 1, _id: 0 })',
    'db.items.find({}, { "_id.first": 1 })',
    'db.items.find({}, { "values.$": 1 })',
    'db.items.find({}, { values: { $slice: -1 } })',
    'driverDb.collection("items").find({}, { returnKey: true })',
    'db.items.find().project({ ...projection })',
    'db.items.find(); [{ _id: 3 }]',
    'db.items.find().toArray().map(doc => doc)',
    'db[target].findOne()',
    'show collections'
  ])('keeps derived or unknown results read-only for %s', (code) => {
    expect(prepareShellInput(code, 'test').documentSource).toBeUndefined()
  })
})
