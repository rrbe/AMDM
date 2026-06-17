/**
 * Pure inline ghost-text decision (`computeInlineHint`). The CodeMirror
 * StateField/widget wiring in ghostText.ts isn't unit-tested (it's DOM-bound).
 */
import { describe, it, expect } from 'vitest'
import { computeInlineHint } from '@renderer/lib/inlineHint'

describe('computeInlineHint', () => {
  it('sort({ _id: → -1', () => {
    expect(computeInlineHint('db.c.find().sort({ _id: ')).toEqual({ insert: '-1' })
  })

  it('$sort: { _id: → -1', () => {
    expect(computeInlineHint('db.c.aggregate([{ $sort: { _id: ')).toEqual({ insert: '-1' })
  })

  it('no trailing space still fires', () => {
    expect(computeInlineHint('db.c.find().sort({ createdAt:')).toEqual({ insert: '-1' })
  })

  it('multi-key sort after a comma → -1', () => {
    expect(computeInlineHint('db.c.find().sort({ a: 1, b: ')).toEqual({ insert: '-1' })
  })

  it('value already typed → null (no double hint)', () => {
    expect(computeInlineHint('db.c.find().sort({ _id: -1')).toBeNull()
  })

  it('inside a string literal → null', () => {
    expect(computeInlineHint('db.c.find({ note: "x: ')).toBeNull()
  })

  it('plain query value → null (conservative; only sort/projection fire)', () => {
    expect(computeInlineHint('db.c.find({ name: ')).toBeNull()
  })

  it('not at a value slot → null', () => {
    expect(computeInlineHint('db.c.fi')).toBeNull()
  })
})
