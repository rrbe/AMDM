/**
 * Doc-action availability helpers (pure parts only; the confirm/delete side
 * effect that touches window/store is exercised elsewhere).
 */
import { describe, it, expect } from 'vitest'
import { docActionContext, docHasId } from '@renderer/lib/docActions'

const lastQuery = { connectionId: 'c1', database: 'db1' }

describe('docActionContext', () => {
  it('returns the context when result has a collection and lastQuery is set', () => {
    expect(docActionContext({ collection: 'users' } as never, lastQuery)).toEqual({
      connectionId: 'c1',
      database: 'db1',
      collection: 'users'
    })
  })
  it('is null without a result, without a collection, or without lastQuery', () => {
    expect(docActionContext(null, lastQuery)).toBeNull()
    expect(docActionContext({ collection: '' } as never, lastQuery)).toBeNull()
    expect(docActionContext({ collection: 'users' } as never, null)).toBeNull()
  })
})

describe('docHasId', () => {
  it('accepts any defined _id, including falsy ones', () => {
    expect(docHasId({ _id: 1 })).toBe(true)
    expect(docHasId({ _id: 0 })).toBe(true)
    expect(docHasId({ _id: '' })).toBe(true)
    expect(docHasId({ _id: null })).toBe(true)
  })
  it('rejects missing/undefined _id and non-objects', () => {
    expect(docHasId({})).toBe(false)
    expect(docHasId({ _id: undefined })).toBe(false)
    expect(docHasId(5)).toBe(false)
    expect(docHasId(null)).toBe(false)
    expect(docHasId([1])).toBe(false)
  })
})
