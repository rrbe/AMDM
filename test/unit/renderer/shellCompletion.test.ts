/**
 * Member-access detection — the split point between the TS-service engine
 * (member access) and the regex source (operators / value slots / fields).
 */
import { describe, it, expect } from 'vitest'
import { isMemberCompletion } from '@renderer/lib/shellCompletion'

describe('isMemberCompletion', () => {
  it('true after a member dot (db / collection / cursor / call chains)', () => {
    expect(isMemberCompletion('db.')).toBe(true)
    expect(isMemberCompletion('db.users.fi')).toBe(true)
    expect(isMemberCompletion('db.users.find().so')).toBe(true)
    expect(isMemberCompletion('db.getSiblingDB("x").')).toBe(true)
  })

  it('false for operator / value-slot / field positions handled by the regex source', () => {
    expect(isMemberCompletion('db.users.find({ $')).toBe(false)
    expect(isMemberCompletion('db.users.find().sort({ _id: ')).toBe(false)
    expect(isMemberCompletion('db.users.find({ na')).toBe(false)
    expect(isMemberCompletion('db')).toBe(false)
  })

  it('false inside a string literal', () => {
    expect(isMemberCompletion('db.coll.find({ note: "a.')).toBe(false)
  })
})
