import type { ShellResult } from '@shared/types'
import { isEjsonWrapper } from '@shared/jsonSerialization'
import { isPlainObject } from './tableShape'
import { formatEjsonDate } from './ejson'

export interface ResultChartConfig {
  type: 'bar' | 'line' | 'pie'
  x: string
  y: string
}

export const DEFAULT_CHART_CONFIG: ResultChartConfig = { type: 'bar', x: '', y: '' }

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
  y: number | null
  rawY: string
}

export function prepareChart(docs: unknown[], config: ResultChartConfig, timeZone?: string) {
  const points: ChartPoint[] = []
  let invalid = 0
  let approximate = 0
  const kinds = new Set<ChartScalar['kind']>()
  for (const doc of docs) {
    const x = isPlainObject(doc) && Object.hasOwn(doc, config.x) ? scalar(doc[config.x], timeZone) : null
    const y = isPlainObject(doc) && Object.hasOwn(doc, config.y) ? scalar(doc[config.y]) : null
    if (!x) { invalid++; continue }
    kinds.add(x.kind)
    if (y?.kind !== 'number') invalid++
    if (x.approximate || y?.approximate) approximate++
    points.push({ x: x.value, label: x.label, y: y?.kind === 'number' ? y.value as number : null, rawY: y?.kind === 'number' ? y.label : '' })
  }
  const axis = kinds.size === 1 && kinds.has('date') ? 'time' : kinds.size === 1 && kinds.has('number') ? 'value' : 'category'
  if (config.type === 'line' && axis !== 'category') points.sort((a, b) => Number(a.x) - Number(b.x))
  let error: 'noValues' | 'pieValues' | 'pieDuplicates' | null = null
  if (!points.some((point) => point.y !== null)) error = 'noValues'
  if (config.type === 'pie' && !error) {
    const values = points.filter((point) => point.y !== null)
    const sum = values.reduce((total, point) => total + point.y!, 0)
    if (invalid || values.some((point) => point.y! < 0) || !Number.isFinite(sum) || sum <= 0) error = 'pieValues'
    else if (new Set(values.map((point) => point.label)).size !== values.length) error = 'pieDuplicates'
  }
  return { points, axis, invalid, approximate, error }
}

export function chartHasCompleteResult(result: ShellResult): boolean {
  const count = Array.isArray(result.data) ? result.data.length : 0
  return result.kind === 'documents' && (result.skip ?? 0) === 0 && result.truncated === false
    && (result.totalCount === undefined || result.totalCount === count)
}
