import type { ShellResult } from '@shared/types'
import { isEjsonWrapper } from '@shared/jsonSerialization'
import { isPlainObject } from './tableShape'
import { formatEjsonDate } from './ejson'

export type ChartMetric = string | null
export type ChartAggregation = 'raw' | 'sum' | 'average'

export interface ResultChartConfig {
  type: 'bar' | 'line' | 'pie'
  dimension: string
  metrics: ChartMetric[]
  pieMetric?: ChartMetric
  aggregations?: Record<string, ChartAggregation>
}

export const DEFAULT_CHART_CONFIG: ResultChartConfig = { type: 'bar', dimension: '', metrics: [] }

export function chartFieldAggregation(config: ResultChartConfig, field: string): ChartAggregation {
  return config.aggregations && Object.hasOwn(config.aggregations, field) ? config.aggregations[field] : 'raw'
}

type ChartScalar = { kind: 'category' | 'number' | 'date'; key: string; value: string | number; label: string; approximate?: boolean }

function scalar(value: unknown, timeZone?: string): ChartScalar | null {
  if (typeof value === 'string' || typeof value === 'boolean') {
    return { kind: 'category', key: `${typeof value}:${value}`, value: String(value), label: String(value) }
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? { kind: 'number', key: `number:${value}`, value, label: String(value) } : null
  }
  if (!isEjsonWrapper(value)) return null
  if ('$date' in value) {
    const raw = value.$date
    const timestamp = isPlainObject(raw) ? Number(raw.$numberLong) : new Date(raw as string).getTime()
    if (!Number.isFinite(timestamp) || Math.abs(timestamp) > 8.64e15) return null
    return { kind: 'date', key: `date:${timestamp}`, value: timestamp, label: formatEjsonDate(raw, timeZone) }
  }
  for (const key of ['$numberInt', '$numberLong', '$numberDouble', '$numberDecimal']) {
    if (!(key in value)) continue
    const number = Number(value[key])
    if (!Number.isFinite(number)) return null
    if (key === '$numberLong' && !Number.isSafeInteger(number)) return null
    if (key === '$numberDecimal' && number === 0 && /[1-9]/.test(String(value[key]).split(/[eE]/)[0])) return null
    return { kind: 'number', key: key === '$numberDecimal' ? `decimal:${value[key]}` : `number:${number}`, value: number, label: String(value[key]), approximate: key === '$numberDecimal' }
  }
  if ('$oid' in value) return { kind: 'category', key: `oid:${value.$oid}`, value: String(value.$oid), label: String(value.$oid) }
  return null
}

export interface ChartPoint {
  x: string | number
  label: string
  values: { value: number | null; raw: string }[]
}

export function prepareChart(docs: unknown[], config: ResultChartConfig, timeZone?: string) {
  const metrics = config.type === 'pie'
    ? [config.pieMetric === undefined ? config.metrics[0] : config.pieMetric].filter((field) => field !== undefined && field !== '')
    : config.metrics
  const aggregations = metrics.map((metric) => metric === null ? 'count' : chartFieldAggregation(config, metric))
  const grouped = aggregations.length > 0 && aggregations.every((aggregation) => aggregation !== 'raw')
  const mixed = aggregations.some((aggregation) => aggregation === 'raw') && aggregations.some((aggregation) => aggregation !== 'raw')
  const points: ChartPoint[] = []
  const groups = new Map<string, { point: ChartPoint; totals: number[]; counts: number[] }>()
  let overflow = false
  let invalid = 0
  let approximate = 0
  const kinds = new Set<ChartScalar['kind']>()
  for (const doc of docs) {
    const x = isPlainObject(doc) && Object.hasOwn(doc, config.dimension) ? scalar(doc[config.dimension], timeZone) : null
    if (!x) { invalid++; continue }
    kinds.add(x.kind)
    let invalidRow = false
    let approximateRow = !!x.approximate
    const values = metrics.map((field) => {
      if (field === null) return { value: 1, raw: '1' }
      const metric = isPlainObject(doc) && Object.hasOwn(doc, field) ? scalar(doc[field]) : null
      if (metric?.kind !== 'number') invalidRow = true
      if (metric?.approximate) approximateRow = true
      return { value: metric?.kind === 'number' ? metric.value as number : null, raw: metric?.kind === 'number' ? metric.label : '' }
    })
    if (invalidRow) invalid++
    if (approximateRow) approximate++
    if (!grouped) {
      points.push({ x: x.value, label: x.label, values })
      continue
    }
    let group = groups.get(x.key)
    if (!group) {
      group = {
        point: { x: x.value, label: x.label, values: metrics.map(() => ({ value: null, raw: '' })) },
        totals: metrics.map(() => 0),
        counts: metrics.map(() => 0)
      }
      groups.set(x.key, group)
      points.push(group.point)
    }
    values.forEach(({ value }, index) => {
      if (value === null) return
      group.totals[index] += value
      group.counts[index]++
      const aggregate = aggregations[index] === 'average' ? group.totals[index] / group.counts[index] : group.totals[index]
      if (!Number.isFinite(aggregate)) overflow = true
      group.point.values[index] = { value: Number.isFinite(aggregate) ? aggregate : null, raw: String(aggregate) }
    })
  }
  const axis = kinds.size === 1 && kinds.has('date') ? 'time' : kinds.size === 1 && kinds.has('number') ? 'value' : 'category'
  if (config.type === 'line' && axis !== 'category') points.sort((a, b) => Number(a.x) - Number(b.x))
  let error: 'noValues' | 'pieValues' | 'pieDuplicates' | 'mixedAggregation' | 'aggregationOverflow' | null = null
  if (!points.some((point) => point.values.some((metric) => metric.value !== null))) error = 'noValues'
  if (overflow) error = 'aggregationOverflow'
  if (mixed) error = 'mixedAggregation'
  if (config.type === 'pie' && !error) {
    const values = points.filter((point) => point.values[0].value !== null)
    const sum = values.reduce((total, point) => total + point.values[0].value!, 0)
    if (invalid || values.some((point) => point.values[0].value! < 0) || !Number.isFinite(sum) || sum <= 0) error = 'pieValues'
    else if (new Set(values.map((point) => point.label)).size !== values.length) error = 'pieDuplicates'
  }
  return { points, metrics, axis, invalid, approximate, error }
}

export function chartHasCompleteResult(result: ShellResult): boolean {
  const count = Array.isArray(result.data) ? result.data.length : 0
  return result.kind === 'documents' && (result.skip ?? 0) === 0 && result.truncated === false
    && (result.totalCount === undefined || result.totalCount === count)
}
