import { describe, expect, it } from 'vitest'
import { chartHasCompleteResult, prepareChart } from '../../../src/renderer/src/lib/resultChart'

const bar = { type: 'bar' as const, dimension: 'label', metrics: ['amount'] }

describe('result chart data', () => {
  it('reads canonical BSON values and keeps exact Decimal tooltip text', () => {
    const result = prepareChart([
      { label: 'a', amount: { $numberInt: '7' } },
      { label: 'b', amount: { $numberLong: '9007199254740991' } },
      { label: 'c', amount: { $numberDecimal: '1.234567890123456789' } },
      { label: 'd', amount: { $numberDouble: '2.5' } }
    ], bar)
    expect(result.points.map((p) => p.values[0].value)).toEqual([7, 9007199254740991, 1.2345678901234567, 2.5])
    expect(result.points[2].values[0].raw).toBe('1.234567890123456789')
    expect(result.approximate).toBe(1)
  })

  it('does not turn missing, non-numeric, unsafe Long or non-finite values into zero', () => {
    const values = [0, null, '12', { $numberLong: '9007199254740993' }, { $numberDouble: 'NaN' }, { $numberDecimal: '1E-6176' }]
    const result = prepareChart(values.map((amount, label) => ({ label, amount })), { ...bar, type: 'line' })
    expect(result.points.map((p) => p.values[0].value)).toEqual([0, null, null, null, null, null])
    expect(result.invalid).toBe(5)
  })

  it('sorts numeric/time line axes, preserving gaps and selected display zone', () => {
    const result = prepareChart([
      { label: { $date: { $numberLong: '86400000' } }, amount: 2 },
      { label: { $date: { $numberLong: '0' } }, amount: 1 },
      { label: { $date: { $numberLong: '43200000' } }, amount: null }
    ], { ...bar, type: 'line' }, 'Asia/Shanghai')
    expect(result.axis).toBe('time')
    expect(result.points.map((p) => p.values[0].value)).toEqual([1, null, 2])
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
    const result = prepareChart([{ 'a.b': 'exact', amount: 5 }, { 'a.b': ['x'], amount: 2 }], { ...bar, dimension: 'a.b' })
    expect(result.points).toEqual([{ x: 'exact', label: 'exact', values: [{ value: 5, raw: '5' }] }])
    expect(result.invalid).toBe(1)
  })

  it('keeps categorical line order and raw duplicate bar rows', () => {
    const docs = [{ label: 'b', amount: 2 }, { label: 'a', amount: 1 }, { label: 'a', amount: 3 }]
    expect(prepareChart(docs, bar).points.map((p) => p.values[0].value)).toEqual([2, 1, 3])
    expect(prepareChart(docs, { ...bar, type: 'line' }).points.map((p) => p.label)).toEqual(['b', 'a', 'a'])
  })

  it('keeps metrics aligned when sorting and counts affected rows once', () => {
    const result = prepareChart([
      { label: 3, amount: null, cost: 'invalid' },
      { label: 1, amount: { $numberDecimal: '1.234567890123456789' }, cost: { $numberDecimal: '2.3' } },
      { label: 2, amount: 20, cost: null },
      { label: null, amount: 30, cost: 15 }
    ], { ...bar, type: 'line', metrics: ['amount', 'cost'] })
    expect(result.metrics).toEqual(['amount', 'cost'])
    expect(result.points.map((point) => [point.x, ...point.values.map((metric) => metric.value)]))
      .toEqual([[1, 1.2345678901234567, 2.3], [2, 20, null], [3, null, null]])
    expect(result.points[0].values[0].raw).toBe('1.234567890123456789')
    expect(result.invalid).toBe(3)
    expect(result.approximate).toBe(1)
    expect(result.error).toBeNull()
    expect(prepareChart([{ label: 'a', cost: 2 }], { ...bar, metrics: ['amount', 'cost'] }).error).toBeNull()
    expect(prepareChart([{ label: 'a', cost: 2 }], { ...bar, metrics: [] }).error).toBe('noValues')
  })

  it('uses one pie metric while preserving the multi-metric selection', () => {
    const config = { ...bar, type: 'pie' as const, metrics: ['amount', 'cost'] }
    const docs = [{ label: 'a', amount: 2, cost: -1 }, { label: 'b', amount: 3, cost: 4 }]
    expect(prepareChart(docs, config).metrics).toEqual(['amount'])
    expect(prepareChart(docs, config).error).toBeNull()
    expect(prepareChart(docs, { ...config, pieMetric: 'cost' }).error).toBe('pieValues')
    const line = prepareChart(docs, { ...config, type: 'line', pieMetric: 'cost' })
    expect(line.metrics).toEqual(['amount', 'cost'])
    expect(line.points.map((point) => point.values.map((metric) => metric.value))).toEqual([[2, -1], [3, 4]])
    expect(config.metrics).toEqual(['amount', 'cost'])
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
