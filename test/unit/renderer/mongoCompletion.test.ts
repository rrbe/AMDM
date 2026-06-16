/**
 * Pure shell-completion decision core (`computeShellCompletion`). The store-
 * reading wrapper `mongoCompletionSource` isn't unit-tested (it's store-bound).
 */
import { describe, it, expect } from 'vitest'
import { computeShellCompletion, type CompletionData } from '@renderer/lib/mongoCompletion'

// Run the core against the full text-before-cursor (cursor at the end).
function complete(before: string, data: Partial<CompletionData> = {}): { from: number; labels: string[] } {
  const r = computeShellCompletion(before, before.length, {
    collections: data.collections ?? [],
    fields: data.fields ?? []
  })
  return { from: r?.from ?? -1, labels: (r?.options ?? []).map((o) => o.label) }
}

describe('computeShellCompletion', () => {
  it('db. → collection names + db methods', () => {
    const { labels, from } = complete('db.', { collections: ['users', 'orders'] })
    expect(labels).toContain('users')
    expect(labels).toContain('orders')
    expect(labels).toContain('getCollection')
    expect(from).toBe(3) // empty word, inserted at the cursor
  })

  it('db.users.fi → collection methods', () => {
    const { labels, from } = complete('db.users.fi')
    expect(labels).toContain('find')
    expect(labels).toContain('findOne')
    expect(from).toBe('db.users.'.length) // replaces "fi"
  })

  it('cursor chain `).so` → cursor methods', () => {
    const { labels } = complete('db.users.find().so')
    expect(labels).toEqual(expect.arrayContaining(['sort', 'limit', 'skip']))
  })

  it('inside find({ $ → query operators (no update ops)', () => {
    const { labels } = complete('db.users.find({ $')
    expect(labels).toContain('$eq')
    expect(labels).not.toContain('$set')
  })

  it('inside aggregate([{ $ → aggregation stages', () => {
    const { labels } = complete('db.users.aggregate([{ $')
    expect(labels).toEqual(expect.arrayContaining(['$group', '$match']))
  })

  it('fallback inside find({ → globals + literals + fields', () => {
    const { labels } = complete('db.users.find({ na', { fields: ['_id', 'name'] })
    expect(labels).toContain('ObjectId') // shell global
    expect(labels).toContain('null') // js literal
    expect(labels).toContain('name') // sampled field
  })

  // ---- value-slot branch ----
  it('sort({ _id: → 1 / -1', () => {
    const { labels, from } = complete('db.c.find().sort({ _id: ')
    expect(labels).toEqual(['1', '-1'])
    expect(from).toBe('db.c.find().sort({ _id: '.length) // inserted at cursor
  })

  it('projection find({}, { name: → 1 / 0', () => {
    const { labels } = complete('db.c.find({}, { name: ')
    expect(labels).toEqual(['1', '0'])
  })

  it('boolean option key upsert: → true / false', () => {
    const { labels } = complete('db.c.updateOne({}, {}, { upsert: ')
    expect(labels).toEqual(['true', 'false'])
  })

  it('plain query value find({ name: → no 1/-1 (falls through to globals)', () => {
    const { labels } = complete('db.c.find({ name: ', { fields: ['name'] })
    expect(labels).not.toContain('-1')
    expect(labels).not.toContain('1')
    expect(labels).toContain('ObjectId')
  })
})
