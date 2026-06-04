/**
 * JSON-line builder for the virtualized JSON view (shell-style scalars).
 */
import { describe, it, expect } from 'vitest'
import { toJsonLines, indentFor } from '@renderer/lib/format'

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
})

describe('indentFor', () => {
  it('returns two spaces per depth unit', () => {
    expect(indentFor(0)).toBe('')
    expect(indentFor(1)).toBe('  ')
    expect(indentFor(3)).toBe('      ')
  })
})
