import { describe, expect, it } from 'vitest'
import { completionDoc, methodCompletion, withCompletionInfo } from '@renderer/lib/completionInfo'

describe('completion info', () => {
  it('provides signatures, descriptions, and examples for common methods', () => {
    expect(completionDoc({ label: 'find', type: 'method' })).toEqual({
      signature: 'find(query, projection?)',
      summary: 'Selects documents and returns a cursor.',
      example: 'db.products.find({ qty: { $gte: 25, $lt: 35 } })'
    })
  })

  it('provides contextual fallback documentation for operators and methods', () => {
    expect(completionDoc({ label: '$gte', type: 'property', detail: 'query op' })).toMatchObject({
      signature: '$gte: value',
      summary: 'Matches values greater than or equal to the specified value.'
    })
    expect(completionDoc({ label: 'watch', type: 'method', detail: 'collection' })).toEqual({
      signature: 'watch(…)',
      summary: 'MongoDB collection method.'
    })
  })

  it('only attaches an info panel when documentation is available', () => {
    expect(typeof withCompletionInfo({ label: 'find', type: 'method' }).info).toBe('function')
    expect(
      withCompletionInfo({
        label: 'customerName',
        type: 'variable',
        detail: 'field'
      }).info
    ).toBeUndefined()
  })

  it('does not attach method or constructor docs to collections and fields with the same name', () => {
    expect(completionDoc({ label: 'find', type: 'class', detail: 'collection' })).toBeNull()
    expect(completionDoc({ label: 'sort', type: 'variable', detail: 'field' })).toBeNull()
    expect(completionDoc({ label: 'ObjectId', type: 'variable', detail: 'field' })).toBeNull()
    expect(completionDoc({ label: 'ObjectId', type: 'keyword', detail: 'constructor' })).toMatchObject({
      signature: 'ObjectId(hex?)'
    })
  })

  it('uses snippets for parameterized methods and plain insertion for zero-argument methods', () => {
    expect(typeof methodCompletion('sort', 'cursor').apply).toBe('function')
    expect(methodCompletion('toArray', 'cursor').apply).toBe('toArray()')
  })
})
