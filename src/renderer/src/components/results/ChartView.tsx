import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { init, use, type EChartsType } from 'echarts/core'
import { BarChart, LineChart, PieChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { ShellResult } from '@shared/types'
import { Select } from '@renderer/components/ui/Select'
import { SearchableSelect, type SearchableSelectOption } from '@renderer/components/ui/SearchableSelect'
import { chartHasCompleteResult, prepareChart, type ResultChartConfig } from '@renderer/lib/resultChart'
import { formatEjsonDate } from '@renderer/lib/ejson'
import { useResultTimeZone } from './ResultTimeZone'

use([BarChart, LineChart, PieChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer])

export function ChartView({ docs, fields, result, config, onChange }: {
  docs: unknown[]
  fields: string[] | undefined
  result: ShellResult
  config: ResultChartConfig
  onChange: (config: ResultChartConfig) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const timeZone = useResultTimeZone()
  const host = useRef<HTMLDivElement>(null)
  const chart = useRef<EChartsType | null>(null)
  const [themeVersion, setThemeVersion] = useState(0)
  const data = useMemo(() => prepareChart(docs, config, timeZone), [docs, config, timeZone])
  const ready = fields !== undefined && fields.includes(config.x) && fields.includes(config.y)
  const error = ready ? data.error : null
  const options = useMemo(() => (fields ?? []).map((field) => ({ value: field, label: field, filterText: field })), [fields])

  const matchesField = useMemo(() => {
    let previousQuery: string | undefined
    let matching = new Set<string>()
    return (option: SearchableSelectOption<string>, query: string): boolean => {
      if (query !== previousQuery) {
        previousQuery = query
        matching = new Set()
        const search = query.toLowerCase()
        for (const candidate of options) {
          if (candidate.filterText.toLowerCase().includes(search)) matching.add(candidate.value)
          if (matching.size === 100) break
        }
      }
      return matching.has(option.value)
    }
  }, [options])

  useEffect(() => {
    const element = host.current!
    const instance = init(element, undefined, { renderer: 'canvas' })
    chart.current = instance
    let frame = 0
    const resize = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => instance.resize())
    })
    resize.observe(element)
    const theme = new MutationObserver(() => setThemeVersion((value) => value + 1))
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] })
    return () => {
      cancelAnimationFrame(frame)
      resize.disconnect()
      theme.disconnect()
      chart.current = null
      instance.dispose()
    }
  }, [])

  useEffect(() => {
    const instance = chart.current!
    if (!ready || error) { instance.clear(); return }
    const style = getComputedStyle(host.current!)
    const token = (name: string) => style.getPropertyValue(name).trim()
    const colors = ['--t-number', '--t-string', '--t-boolean', '--t-objectId', '--t-null'].map(token)
    const axis = config.type === 'line' ? data.axis : 'category'
    const points = data.points.map((point) => ({
      name: point.label,
      value: config.type === 'pie' || axis === 'category' ? point.y : [point.x, point.y],
      rawY: point.rawY
    }))
    const axisStyle = { axisLabel: { color: token('--text-secondary') }, axisLine: { lineStyle: { color: token('--separator-strong') } }, splitLine: { lineStyle: { color: token('--separator') } } }
    instance.setOption({
      animation: false,
      color: colors,
      textStyle: { color: token('--text-primary'), fontFamily: style.fontFamily },
      tooltip: {
        trigger: 'item', renderMode: 'richText', confine: true,
        backgroundColor: token('--surface-elevated'), borderColor: token('--separator-strong'),
        textStyle: { color: token('--text-primary') },
        formatter: (params: { name: string; data: unknown; percent?: number }) => {
          const point = params.data as { rawY: string }
          return `${params.name}\n${config.y}: ${point.rawY}${config.type === 'pie' ? ` (${params.percent}%)` : ''}`
        }
      },
      ...(config.type === 'pie' ? {
        legend: { type: 'scroll', selectedMode: false, bottom: 4, textStyle: { color: token('--text-secondary') } },
        series: [{ type: 'pie', radius: '65%', center: ['50%', '45%'], label: { show: false }, data: points }]
      } : {
        grid: { top: 28, left: 20, right: 24, bottom: 24, containLabel: true },
        xAxis: {
          ...axisStyle, type: axis, scale: axis !== 'category',
          ...(axis === 'category' ? { data: data.points.map((point) => point.label), axisLabel: { ...axisStyle.axisLabel, hideOverlap: true, width: 100, overflow: 'truncate' } } : {}),
          ...(axis === 'time' ? { axisLabel: { ...axisStyle.axisLabel, hideOverlap: true, formatter: (value: number) => formatEjsonDate({ $numberLong: String(value) }, timeZone).slice(0, 19).replace('T', '\n') } } : {})
        },
        yAxis: { ...axisStyle, type: 'value', scale: config.type === 'line' },
        series: [{ name: config.y, type: config.type, data: points, connectNulls: false, showSymbol: data.points.length <= 100, barMaxWidth: 60 }]
      })
    }, { notMerge: true })
  }, [config, data, ready, error, timeZone, themeVersion])

  const message = !fields ? t('chart.loading') : !ready ? t('chart.chooseFields') : error ? t(`chart.${error}`) : null
  return (
    <div className="flex h-full min-h-0 flex-col [font-family:var(--font-ui)]" data-chart-view="">
      <div className="flex shrink-0 items-center gap-3 overflow-x-auto border-b border-[var(--separator)] px-4 py-3">
        <Select value={config.type} options={(['bar', 'line', 'pie'] as const).map((value) => ({ value, label: t(`chart.${value}`) }))} onChange={(type) => onChange({ ...config, type })} aria-label={t('chart.type')} className="h-8 w-32 shrink-0 text-xs" />
        {(['x', 'y'] as const).map((axis) => (
          <div key={axis} className="flex shrink-0 items-center gap-2">
            <span className="text-xs text-muted-foreground">{t(axis === 'x' ? 'chart.dimension' : 'chart.metric')}</span>
            <SearchableSelect value={config[axis]} options={options}
              matches={matchesField}
              onChange={(field) => onChange({ ...config, [axis]: field })}
              triggerContent={<span className="truncate px-2">{config[axis] || t('chart.selectField')}</span>}
              placeholder={t('result.searchFields')} emptyMessage={t('result.noMatchingFields')}
              aria-label={t(axis === 'x' ? 'chart.dimension' : 'chart.metric')}
              className="h-8 w-40 text-xs" popupClassName="w-64 max-h-72" />
          </div>
        ))}
      </div>
      <div className="flex shrink-0 flex-wrap gap-x-4 gap-y-1 px-4 py-2 text-xs text-muted-foreground" aria-live="polite">
        <span data-chart-scope="">{t(chartHasCompleteResult(result) ? 'chart.complete' : 'chart.page', { count: docs.length })}</span>
        {options.length > 100 && <span>{t('chart.fieldLimit')}</span>}
        {ready && data.invalid > 0 && <span>{t('chart.invalid', { count: data.invalid })}</span>}
        {ready && data.approximate > 0 && <span>{t('chart.approximate')}</span>}
      </div>
      <div className="relative min-h-0 flex-1">
        <div ref={host} className="h-full w-full" role="img" aria-label={t('chart.description', { type: t(`chart.${config.type}`), x: config.x, y: config.y })} data-chart-type={config.type} data-chart-points={ready && !error ? data.points.length : 0} />
        {message && <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-muted-foreground" role="status">{message}</div>}
      </div>
    </div>
  )
}
