/**
 * Pure helpers from the shell core: cross-realm error description + best-effort
 * collection detection for doc edit/delete.
 */
import { describe, it, expect } from 'vitest'
import { describeError, detectCollection } from '../../../src/main/mongo/shellCore'

describe('describeError', () => {
  it('reads a real Error', () => {
    expect(describeError(new TypeError('boom'))).toEqual({ error: 'boom', errorName: 'TypeError' })
  })
  it('duck-types a cross-realm error (instanceof Error is false in the vm)', () => {
    expect(describeError({ name: 'ReferenceError', message: 'x is not defined' })).toEqual({
      error: 'x is not defined',
      errorName: 'ReferenceError'
    })
  })
  it('falls back to Error when only a message is present', () => {
    expect(describeError({ message: 'm' })).toEqual({ error: 'm', errorName: 'Error' })
  })
  it('keeps a custom name even without a message', () => {
    expect(describeError({ name: 'CustomError' }).errorName).toBe('CustomError')
  })
  it('stringifies non-object throwables', () => {
    expect(describeError('plain string')).toEqual({ error: 'plain string', errorName: 'Error' })
    expect(describeError(42)).toEqual({ error: '42', errorName: 'Error' })
    expect(describeError(null)).toEqual({ error: 'null', errorName: 'Error' })
  })
})

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
