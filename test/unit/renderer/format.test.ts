/**
 * JSON-line builder for the virtualized JSON view (shell-style scalars).
 */
import { describe, it, expect } from 'vitest'
import { toInlineJsonTokens, toJsonLines, visibleJsonLineIndexes, indentFor } from '@renderer/lib/format'

const OID = '64b7f0f0f0f0f0f0f0f0f0f0'
const texts = (v: unknown): string[] => toJsonLines(v).map((l) => l.text)

describe('toJsonLines', () => {
  it('renders a root scalar on one line', () => {
    expect(toJsonLines(5)).toEqual([{ depth: 0, text: '5', tokens: [{ text: '5', cls: 'v-number' }] }])
  })
  it('quotes a root string', () => {
    expect(texts('hi')).toEqual(['"hi"'])
  })
  it('renders extended scalars shell-style', () => {
    const [line] = toJsonLines({ $oid: OID })
    expect(line.text).toBe(`ObjectId("${OID}")`)
    expect(line.tokens).toEqual([{ text: `ObjectId("${OID}")`, cls: 'v-objectId' }])
  })
  it('flattens an object with trailing commas on all but the last entry', () => {
    expect(texts({ a: 1, b: 2 })).toEqual(['{', '"a": 1,', '"b": 2', '}'])
  })
  it('flattens an array', () => {
    expect(texts([1, 2])).toEqual(['[', '1,', '2', ']'])
  })
  it('collapses empty containers to a single line', () => {
    expect(texts({})).toEqual(['{}'])
    expect(texts([])).toEqual(['[]'])
  })
  it('nests with increasing depth', () => {
    const lines = toJsonLines({ a: { b: 1 } })
    expect(lines.map((l) => [l.depth, l.text])).toEqual([
      [0, '{'],
      [1, '"a": {'],
      [2, '"b": 1'],
      [1, '}'],
      [0, '}']
    ])
  })

  it('tracks nested array objects and keeps the closing comma when folded', () => {
    const lines = toJsonLines([{ a: [1, 2] }, { b: 3 }])
    expect(lines[0].fold).toEqual({ end: 10, closeText: ']' })
    expect(lines[1].fold).toEqual({ end: 6, closeText: '},' })
    expect(lines[2].fold).toEqual({ end: 5, closeText: ']' })
    expect(visibleJsonLineIndexes(lines, new Set([1]))).toEqual([0, 1, 7, 8, 9, 10])
    expect(visibleJsonLineIndexes(lines, new Set([1, 7]))).toEqual([0, 1, 7, 10])
  })

  it('does not mark empty containers or EJSON scalar wrappers as foldable', () => {
    const lines = toJsonLines({ empty: {}, ids: [{ $oid: OID }] })
    expect(lines.find((line) => line.text === '"empty": {}')?.fold).toBeUndefined()
    expect(lines.find((line) => line.text.includes('ObjectId('))?.fold).toBeUndefined()
    expect(lines.find((line) => line.text === '"ids": [')?.fold).toBeDefined()
  })
})

describe('indentFor', () => {
  it('returns two spaces per depth unit', () => {
    expect(indentFor(0)).toBe('')
    expect(indentFor(1)).toBe('  ')
    expect(indentFor(3)).toBe('      ')
  })
})

describe('toInlineJsonTokens', () => {
  const preview = (value: unknown): string => toInlineJsonTokens(value).map((token) => token.text).join('')

  it('previews immediate fields with their value colors', () => {
    const tokens = toInlineJsonTokens({ notShipped3Days: false, notShipped7Days: false, preTransit5Days: false })
    expect(tokens.map((token) => token.text).join('')).toBe(
      '{ notShipped3Days: false, notShipped7Days: false, preTransit5Days: false }'
    )
    expect(tokens.filter((token) => token.cls === 'v-boolean').map((token) => token.text)).toEqual([
      'false',
      'false',
      'false'
    ])
  })

  it('quotes strings and special keys while keeping BSON wrappers as scalar values', () => {
    expect(preview({ 'full name': 'Ada\nLovelace', count: { $numberInt: '2' }, id: { $oid: OID } })).toBe(
      `{ "full name": "Ada\\nLovelace", count: 2, id: ObjectId("${OID}") }`
    )
    expect(toInlineJsonTokens({ count: { $numberLong: '9007199254740993' } })).toContainEqual({
      text: 'NumberLong("9007199254740993")',
      cls: 'v-long'
    })
  })

  it('shows array items and keeps deeper containers compact', () => {
    expect(preview(['ready', false, 3, null])).toBe('[ "ready", false, 3, null ]')
    expect(preview({ nested: { secret: true }, list: [1, 2], empty: {} })).toBe(
      '{ nested: { … }, list: [ 2 ], empty: {} }'
    )
    expect(preview({})).toBe('{}')
    expect(preview([])).toBe('[]')
  })

  it('limits entries, long text, and traversal depth', () => {
    expect(preview([1, 2, 3, 4, 5, 6])).toBe('[ 1, 2, 3, 4, 5, … ]')
    const value = {
      a: 1, b: 2, c: 3, d: 4, e: 5,
      get f() { throw new Error('outside preview') }
    }
    expect(preview(value)).toBe('{ a: 1, b: 2, c: 3, d: 4, e: 5, … }')
    expect(preview({ text: 'x'.repeat(100_000) }).length).toBeLessThan(100)
    const deep = { get child() { throw new Error('deeper than preview') } }
    expect(preview({ nested: deep })).toBe('{ nested: { … } }')
  })
})
