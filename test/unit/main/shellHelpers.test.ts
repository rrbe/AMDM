import { describe, it, expect } from 'vitest'
import { detectCollection, prepareTopLevelAwait } from '../../../src/main/mongo/shellSupport'

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

describe('prepareTopLevelAwait', () => {
  it('preserves ordinary scripts and wraps explicit await with its completion value', () => {
    expect(prepareTopLevelAwait('db.items.find()')).toBe('db.items.find()')
    expect(prepareTopLevelAwait('await Promise.resolve(42)')).toContain('return (await Promise.resolve(42))')
  })
})
