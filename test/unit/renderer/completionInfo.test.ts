import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
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

  it.each([
    ['distinct', 'field'],
    ['getCollection', 'name'],
    ['getSiblingDB', 'db']
  ])('quotes the string argument of %s while selecting only its placeholder', (method, placeholder) => {
    let state = EditorState.create({ doc: `db.items.${method}` })
    const view = {
      get state() {
        return state
      },
      dispatch(transaction) {
        state = transaction.state
      }
    } as EditorView
    const completion = methodCompletion(method)
    if (typeof completion.apply !== 'function') throw new Error('Expected a snippet')
    completion.apply(view, completion, 'db.items.'.length, state.doc.length)

    expect(state.doc.toString()).toBe(`db.items.${method}("${placeholder}")`)
    expect(state.sliceDoc(state.selection.main.from, state.selection.main.to)).toBe(placeholder)
    state = state.update({
      changes: {
        from: state.selection.main.from,
        to: state.selection.main.to,
        insert: 'orders'
      }
    }).state
    expect(state.doc.toString()).toBe(`db.items.${method}("orders")`)
  })
})
