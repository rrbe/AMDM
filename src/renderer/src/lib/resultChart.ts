import type { ShellResult } from '@shared/types'
import { isEjsonWrapper } from '@shared/jsonSerialization'
import { isPlainObject } from './tableShape'
import { formatEjsonDate } from './ejson'

export interface ResultChartConfig {
  type: 'bar' | 'line' | 'pie'
  dimension: string
  metrics: string[]
  pieMetric?: string
}

export const DEFAULT_CHART_CONFIG: ResultChartConfig = { type: 'bar', dimension: '', metrics: [] }

type ChartScalar = { kind: 'category' | 'number' | 'date'; value: string | number; label: string; approximate?: boolean }

function scalar(value: unknown, timeZone?: string): ChartScalar | null {
  if (typeof value === 'string' || typeof value === 'boolean') {
    return { kind: 'category', value: String(value), label: String(value) }
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? { kind: 'number', value, label: String(value) } : null
  }
  if (!isEjsonWrapper(value)) return null
  if ('$date' in value) {
    const raw = value.$date
    const timestamp = isPlainObject(raw) ? Number(raw.$numberLong) : new Date(raw as string).getTime()
    if (!Number.isFinite(timestamp) || Math.abs(timestamp) > 8.64e15) return null
    return { kind: 'date', value: timestamp, label: formatEjsonDate(raw, timeZone) }
  }
  for (const key of ['$numberInt', '$numberLong', '$numberDouble', '$numberDecimal']) {
    if (!(key in value)) continue
    const number = Number(value[key])
    if (!Number.isFinite(number)) return null
    if (key === '$numberLong' && !Number.isSafeInteger(number)) return null
    if (key === '$numberDecimal' && number === 0 && /[1-9]/.test(String(value[key]).split(/[eE]/)[0])) return null
    return { kind: 'number', value: number, label: String(value[key]), approximate: key === '$numberDecimal' }
  }
  if ('$oid' in value) return { kind: 'category', value: String(value.$oid), label: String(value.$oid) }
  return null
}

export interface ChartPoint {
  x: string | number
  label: string
  values: { value: number | null; raw: string }[]
}

export function prepareChart(docs: unknown[], config: ResultChartConfig, timeZone?: string) {
  const metrics = config.type === 'pie'
    ? [config.pieMetric ?? config.metrics[0]].filter((field) => field !== undefined)
    : config.metrics
  const points: ChartPoint[] = []
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
      const metric = isPlainObject(doc) && Object.hasOwn(doc, field) ? scalar(doc[field]) : null
      if (metric?.kind !== 'number') invalidRow = true
      if (metric?.approximate) approximateRow = true
      return { value: metric?.kind === 'number' ? metric.value as number : null, raw: metric?.kind === 'number' ? metric.label : '' }
    })
    if (invalidRow) invalid++
    if (approximateRow) approximate++
    points.push({ x: x.value, label: x.label, values })
  }
  const axis = kinds.size === 1 && kinds.has('date') ? 'time' : kinds.size === 1 && kinds.has('number') ? 'value' : 'category'
  if (config.type === 'line' && axis !== 'category') points.sort((a, b) => Number(a.x) - Number(b.x))
  let error: 'noValues' | 'pieValues' | 'pieDuplicates' | null = null
  if (!points.some((point) => point.values.some((metric) => metric.value !== null))) error = 'noValues'
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
