import { describe, expect, it } from 'vitest'
import { chartHasCompleteResult, prepareChart } from '../../../src/renderer/src/lib/resultChart'

const bar = { type: 'bar' as const, x: 'label', y: 'amount' }

describe('result chart data', () => {
  it('reads canonical BSON values and keeps exact Decimal tooltip text', () => {
    const result = prepareChart([
      { label: 'a', amount: { $numberInt: '7' } },
      { label: 'b', amount: { $numberLong: '9007199254740991' } },
      { label: 'c', amount: { $numberDecimal: '1.234567890123456789' } },
      { label: 'd', amount: { $numberDouble: '2.5' } }
    ], bar)
    expect(result.points.map((p) => p.y)).toEqual([7, 9007199254740991, 1.2345678901234567, 2.5])
    expect(result.points[2].rawY).toBe('1.234567890123456789')
    expect(result.approximate).toBe(1)
  })

  it('does not turn missing, non-numeric, unsafe Long or non-finite values into zero', () => {
    const values = [0, null, '12', { $numberLong: '9007199254740993' }, { $numberDouble: 'NaN' }, { $numberDecimal: '1E-6176' }]
    const result = prepareChart(values.map((amount, label) => ({ label, amount })), { ...bar, type: 'line' })
    expect(result.points.map((p) => p.y)).toEqual([0, null, null, null, null, null])
    expect(result.invalid).toBe(5)
  })

  it('sorts numeric/time line axes, preserving gaps and selected display zone', () => {
    const result = prepareChart([
      { label: { $date: { $numberLong: '86400000' } }, amount: 2 },
      { label: { $date: { $numberLong: '0' } }, amount: 1 },
      { label: { $date: { $numberLong: '43200000' } }, amount: null }
    ], { ...bar, type: 'line' }, 'Asia/Shanghai')
    expect(result.axis).toBe('time')
    expect(result.points.map((p) => p.y)).toEqual([1, null, 2])
    expect(result.points[0].label).toBe('1970-01-01T08:00:00.000+08:00')
    const numeric = prepareChart([{ label: 10, amount: 1 }, { label: 2, amount: 2 }], { ...bar, type: 'line' })
    expect(numeric.points.map((p) => p.x)).toEqual([2, 10])
  })

  it('rejects misleading pies instead of grouping or changing their denominator', () => {
    const pie = { ...bar, type: 'pie' as const }
    expect(prepareChart([{ label: 'a', amount: 2 }, { label: 'a', amount: 3 }], pie).error).toBe('pieDuplicates')
    expect(prepareChart([{ label: 'a', amount: 2 }, { label: 'b', amount: -1 }], pie).error).toBe('pieValues')
    expect(prepareChart([{ label: 'a', amount: 2 }, { label: 'b', amount: null }], pie).error).toBe('pieValues')
    expect(prepareChart([{ label: 'a', amount: 0 }], pie).error).toBe('pieValues')
    expect(prepareChart([{ label: 'a', amount: 2 }, { label: 'b', amount: 3 }], pie).error).toBeNull()
  })

  it('does not expand arrays or objects, or interpret dotted field names as paths', () => {
    const result = prepareChart([{ 'a.b': 'exact', amount: 5 }, { 'a.b': ['x'], amount: 2 }], { ...bar, x: 'a.b' })
    expect(result.points).toEqual([{ x: 'exact', label: 'exact', y: 5, rawY: '5' }])
    expect(result.invalid).toBe(1)
  })

  it('keeps categorical line order and raw duplicate bar rows', () => {
    const docs = [{ label: 'b', amount: 2 }, { label: 'a', amount: 1 }, { label: 'a', amount: 3 }]
    expect(prepareChart(docs, bar).points.map((p) => p.y)).toEqual([2, 1, 3])
    expect(prepareChart(docs, { ...bar, type: 'line' }).points.map((p) => p.label)).toEqual(['b', 'a', 'a'])
  })

  it('marks only a complete first-to-last page as the complete query result', () => {
    const result = { kind: 'documents' as const, data: [{}, {}], skip: 0, truncated: false, totalCount: 2 }
    expect(chartHasCompleteResult(result)).toBe(true)
    expect(chartHasCompleteResult({ ...result, skip: 100, totalCount: 102 })).toBe(false)
    expect(chartHasCompleteResult({ ...result, truncated: true })).toBe(false)
    expect(chartHasCompleteResult({ ...result, totalCount: 100 })).toBe(false)
    expect(chartHasCompleteResult({ ...result, totalCount: undefined })).toBe(true)
    expect(chartHasCompleteResult({ ...result, truncated: undefined })).toBe(false)
  })
})
