import BigNumber from 'bignumber.js'
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

export function chartFieldAggregation(config: ResultChartConfig, field: string): ChartAggregation {
  return config.aggregations && Object.hasOwn(config.aggregations, field) ? config.aggregations[field] : 'raw'
}

type ChartScalar = { kind: 'category' | 'number' | 'date'; key: string; value: string | number; label: string; approximate?: boolean }

const numberKeys = ['$numberInt', '$numberLong', '$numberDouble', '$numberDecimal'] as const
const Decimal = BigNumber.clone({ DECIMAL_PLACES: 0, ROUNDING_MODE: BigNumber.ROUND_HALF_EVEN })

function numericInput(value: unknown): { raw: string; type: typeof numberKeys[number] | 'number' } | null {
  if (typeof value === 'number') return Number.isFinite(value) ? { raw: String(value), type: 'number' } : null
  if (!isEjsonWrapper(value)) return null
  for (const type of numberKeys) {
    if (type in value) return { raw: String(value[type]), type }
  }
  return null
}

function exactNumber(value: unknown): BigNumber | null {
  const input = numericInput(value)
  if (!input) return null
  const number = new Decimal(input.raw)
  return number.isFinite() ? number : null
}

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
  const numeric = numericInput(value)
  if (numeric) {
    const number = Number(numeric.raw)
    if (!Number.isFinite(number)) return null
    if (numeric.type === '$numberLong' && !Number.isSafeInteger(number)) return null
    const decimal = numeric.type === '$numberDecimal' ? new Decimal(numeric.raw) : null
    if (decimal && number === 0 && !decimal.isZero()) return null
    return { kind: 'number', key: `number:${decimal ?? number}`, value: number, label: numeric.raw, approximate: !!decimal }
  }
  if ('$oid' in value) return { kind: 'category', key: `oid:${value.$oid}`, value: String(value.$oid), label: String(value.$oid) }
  return null
}

export async function prepareChartExampleFields(docs: unknown[], fields: string[], dimension: string, signal: AbortSignal, grouped = false): Promise<string[]> {
  const pending = new Set(fields.filter(Boolean))
  if (pending.size === 0) return []
  let deadline = performance.now() + 6
  for (const doc of docs) {
    if (signal.aborted) return []
    if (isPlainObject(doc) && (!dimension || (Object.hasOwn(doc, dimension) && scalar(doc[dimension])))) {
      for (const field of Object.keys(doc)) {
        if (!pending.has(field)) continue
        const value = doc[field]
        if (dimension && typeof value !== 'number' && (value === null || typeof value !== 'object')) continue
        if (dimension && grouped) {
          if (exactNumber(value)) pending.delete(field)
        } else {
          const normalized = scalar(value)
          if (dimension ? normalized?.kind === 'number' : normalized) pending.delete(field)
        }
      }
      if (pending.size === 0) break
    }
    if (performance.now() >= deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      deadline = performance.now() + 6
    }
  }
  return fields.filter((field) => field && !pending.has(field))
}

export interface ChartPoint {
  x: string | number
  label: string
  values: { value: number | null; raw: string }[]
}

function chartAverage(total: BigNumber, count: number): BigNumber {
  // A terminating quotient needs at most log2(count) extra fractional places.
  const places = total.decimalPlaces()! + Math.ceil(Math.log2(count))
  const quotient = total.shiftedBy(places).div(count).shiftedBy(-places)
  if (quotient.times(count).eq(total)) return quotient

  // Round a recurring quotient once, to 34 significant digits.
  let exponent = total.e! - (String(count).length - 1)
  if (total.abs().lt(new Decimal(count).shiftedBy(exponent))) exponent--
  const shift = 33 - exponent
  return total.shiftedBy(shift).div(count).shiftedBy(-shift)
}

export function prepareChart(docs: unknown[], config: ResultChartConfig, timeZone?: string) {
  const metrics = config.type === 'pie'
    ? [config.pieMetric === undefined ? config.metrics[0] : config.pieMetric].filter((field) => field !== undefined && field !== '')
    : config.metrics
  const aggregations = metrics.map((metric) => metric === null ? 'count' : chartFieldAggregation(config, metric))
  const grouped = aggregations.length > 0 && aggregations.every((aggregation) => aggregation !== 'raw')
  const mixed = aggregations.some((aggregation) => aggregation === 'raw') && aggregations.some((aggregation) => aggregation !== 'raw')
  const points: ChartPoint[] = []
  const groups = new Map<string, { point: ChartPoint; totals: BigNumber[]; counts: number[] }>()
  let overflow = false
  let invalid = 0
  let approximate = 0
  const kinds = new Set<ChartScalar['kind']>()
  for (const doc of docs) {
    if (!isPlainObject(doc)) { invalid++; continue }
    const x = Object.hasOwn(doc, config.dimension) ? scalar(doc[config.dimension], timeZone) : null
    if (!x) { invalid++; continue }
    kinds.add(x.kind)
    let invalidRow = false
    let approximateRow = !!x.approximate
    if (grouped) {
      let group = groups.get(x.key)
      if (!group) {
        group = {
          point: { x: x.value, label: x.label, values: metrics.map(() => ({ value: null, raw: '' })) },
          totals: metrics.map(() => new Decimal(0)),
          counts: metrics.map(() => 0)
        }
        groups.set(x.key, group)
        points.push(group.point)
      }
      for (const [index, field] of metrics.entries()) {
        if (field !== null) {
          const number = Object.hasOwn(doc, field) ? exactNumber(doc[field]) : null
          if (!number) { invalidRow = true; continue }
          group.totals[index] = group.totals[index].plus(number)
        }
        group.counts[index]++
      }
    } else {
      const values = metrics.map((field) => {
        if (field === null) return { value: 1, raw: '1' }
        const metric = Object.hasOwn(doc, field) ? scalar(doc[field]) : null
        if (metric?.kind !== 'number') invalidRow = true
        if (metric?.approximate) approximateRow = true
        return { value: metric?.kind === 'number' ? metric.value as number : null, raw: metric?.kind === 'number' ? metric.label : '' }
      })
      points.push({ x: x.value, label: x.label, values })
    }
    if (invalidRow) invalid++
    if (approximateRow) approximate++
  }
  for (const { point, totals, counts } of groups.values()) {
    for (const [index, total] of totals.entries()) {
      const count = counts[index]
      if (count === 0) continue
      let aggregate = total
      let rounded = false
      if (metrics[index] === null) {
        aggregate = new Decimal(count)
      } else if (aggregations[index] === 'average' && count > 1) {
        aggregate = chartAverage(total, count)
        rounded = !aggregate.times(count).eq(total)
      }
      const value = aggregate.toNumber()
      if (!Number.isFinite(value) || (value === 0 && !aggregate.isZero())) {
        overflow = true
        continue
      }
      if (rounded || !aggregate.eq(String(value))) approximate++
      point.values[index] = { value, raw: (rounded ? '≈' : '') + aggregate.toString() }
    }
  }
  const axis = kinds.size === 1 && kinds.has('date') ? 'time' : kinds.size === 1 && kinds.has('number') ? 'value' : 'category'
  if (config.type !== 'pie' && axis !== 'category') {
    points.sort((a, b) => Number(a.x) - Number(b.x) || (axis === 'value' ? new Decimal(a.label).comparedTo(b.label)! : 0))
  }
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
