/**
 * Doc-action availability helpers (pure parts only; the confirm/delete side
 * effect that touches window/store is exercised elsewhere).
 */
import { describe, it, expect } from 'vitest'
import { docActionContext, docHasId } from '@renderer/lib/docActions'

const lastQuery = { connectionId: 'c1', database: 'db1' }

describe('docActionContext', () => {
  const documentSource = { database: 'other', collection: 'users' }

  it('targets the database and collection of the document read on the query connection', () => {
    expect(docActionContext({ kind: 'value', documentSource }, lastQuery)).toEqual({
      connectionId: 'c1',
      database: 'other',
      collection: 'users'
    })
  })
  it('requires a document source and a query connection', () => {
    expect(docActionContext(null, lastQuery)).toBeNull()
    expect(docActionContext({ kind: 'documents', collection: 'users', data: [{ _id: 'collision' }] }, lastQuery)).toBeNull()
    expect(docActionContext({ kind: 'documents', documentSource }, null)).toBeNull()
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
