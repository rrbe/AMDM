import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChartColumn, ChartLine, ChartPie, Download } from 'lucide-react'
import { init, use, type EChartsType } from 'echarts/core'
import { BarChart, LineChart, PieChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TitleComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { ShellResult } from '@shared/types'
import { Button } from '@renderer/components/common/Button'
import { SearchableSelect, type SearchableSelectOption } from '@renderer/components/ui/SearchableSelect'
import { Tooltip } from '@renderer/components/ui/Tooltip'
import { chartHasCompleteResult, prepareChart, type ResultChartConfig } from '@renderer/lib/resultChart'
import { formatEjsonDate } from '@renderer/lib/ejson'
import { useResultTimeZone } from './ResultTimeZone'

use([BarChart, LineChart, PieChart, GridComponent, LegendComponent, TitleComponent, TooltipComponent, CanvasRenderer])

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
  const ready = fields !== undefined && fields.includes(config.dimension) && data.metrics.length > 0 && data.metrics.every((field) => fields.includes(field))
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
    const series = data.metrics.map((field, index) => ({
      name: field,
      type: config.type,
      data: data.points.map((point) => ({
        name: point.label,
        value: config.type === 'pie' || axis === 'category' ? point.values[index].value : [point.x, point.values[index].value],
        rawValue: point.values[index].raw
      })),
      ...(config.type === 'pie'
        ? { radius: '60%', center: ['50%', '53%'], label: { show: false } }
        : { connectNulls: false, showSymbol: data.points.length <= 100, barMaxWidth: 60 })
    }))
    const dimensionName = t('chart.dimensionName', { field: config.dimension })
    const metricName = data.metrics.length === 1 ? t('chart.metricName', { field: data.metrics[0] }) : t('chart.metrics')
    const nameTextStyle = { color: token('--text-primary'), fontSize: 12 }
    const axisStyle = { axisLabel: { color: token('--text-secondary') }, axisLine: { lineStyle: { color: token('--separator-strong') } }, splitLine: { lineStyle: { color: token('--separator') } } }
    instance.setOption({
      animation: false,
      color: colors,
      textStyle: { color: token('--text-primary'), fontFamily: style.fontFamily },
      tooltip: {
        trigger: 'item', renderMode: 'richText', confine: true,
        backgroundColor: token('--surface-elevated'), borderColor: token('--separator-strong'),
        textStyle: { color: token('--text-primary') },
        formatter: (params: { name: string; seriesName: string; data: unknown; percent?: number }) => {
          const point = params.data as { rawValue: string }
          return `${params.name}\n${params.seriesName}: ${point.rawValue}${config.type === 'pie' ? ` (${params.percent}%)` : ''}`
        }
      },
      series,
      ...(config.type === 'pie' ? {
        title: { text: metricName, subtext: dimensionName, left: 16, top: 12, textStyle: { ...nameTextStyle, fontSize: 14, fontWeight: 500 }, subtextStyle: { color: token('--text-secondary'), fontSize: 12 } },
        legend: { type: 'scroll', selectedMode: false, bottom: 4, textStyle: { color: token('--text-secondary') } }
      } : {
        legend: { show: data.metrics.length > 1, type: 'scroll', selectedMode: false, bottom: 4, textStyle: { color: token('--text-secondary') } },
        grid: { top: 48, left: 24, right: 32, bottom: data.metrics.length > 1 ? 92 : 64, containLabel: true },
        xAxis: {
          ...axisStyle, type: axis, scale: axis !== 'category',
          name: dimensionName, nameLocation: 'middle', nameGap: axis === 'time' ? 52 : 34, nameTextStyle,
          ...(axis === 'category' ? { data: data.points.map((point) => point.label), axisLabel: { ...axisStyle.axisLabel, hideOverlap: true, width: 100, overflow: 'truncate' } } : {}),
          ...(axis === 'time' ? { axisLabel: { ...axisStyle.axisLabel, hideOverlap: true, formatter: (value: number) => formatEjsonDate({ $numberLong: String(value) }, timeZone).slice(0, 19).replace('T', '\n') } } : {})
        },
        yAxis: { ...axisStyle, type: 'value', scale: config.type === 'line', name: metricName, nameLocation: 'end', nameGap: 20, nameTextStyle: { ...nameTextStyle, align: 'left' } }
      })
    }, { notMerge: true })
  }, [config, data, ready, error, timeZone, themeVersion, t])

  const exportPng = (): void => {
    const link = document.createElement('a')
    link.download = `chart-${config.type}.png`
    link.href = chart.current!.getDataURL({
      type: 'png',
      pixelRatio: 2,
      backgroundColor: getComputedStyle(host.current!).getPropertyValue('--surface-content').trim(),
      excludeComponents: ['tooltip']
    })
    link.click()
  }

  const message = !fields ? t('chart.loading') : !ready ? t('chart.chooseFields') : error ? t(`chart.${error}`) : null
  return (
    <div className="@container/chart flex h-full min-h-0 [font-family:var(--font-ui)]" data-chart-view="">
      <div className="flex w-36 shrink-0 flex-col gap-4 overflow-y-auto border-r border-[var(--separator)] px-2 py-3 @min-[720px]/chart:w-40">
        <div className="flex shrink-0 items-center gap-1" role="group" aria-label={t('chart.type')}>
          {(['bar', 'line', 'pie'] as const).map((type) => {
            const Icon = type === 'bar' ? ChartColumn : type === 'line' ? ChartLine : ChartPie
            return (
              <Tooltip key={type} content={t(`chart.${type}`)}>
                <button
                  className={`explorer-nav-item text-xs outline-none focus-visible:shadow-[0_0_0_3px_var(--focus-soft)] ${config.type === type ? 'is-active' : ''}`}
                  aria-label={t(`chart.${type}`)} aria-pressed={config.type === type}
                  onClick={() => onChange({ ...config, type })}
                >
                  <Icon size={16} className="shrink-0" aria-hidden="true" />
                  <span className="explorer-nav-label hidden @min-[720px]/chart:block" aria-hidden="true">
                    <span>{t(`chart.${type}`)}</span>
                  </span>
                </button>
              </Tooltip>
            )
          })}
        </div>
        <div className="flex shrink-0 flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">{t('chart.dimension')}</span>
          <SearchableSelect value={config.dimension} options={options}
            matches={matchesField}
            onChange={(dimension) => onChange({ ...config, dimension })}
            triggerContent={<span className="truncate px-2">{config.dimension || t('chart.selectField')}</span>}
            placeholder={t('result.searchFields')} emptyMessage={t('result.noMatchingFields')}
            aria-label={t('chart.dimension')}
            className="h-8 w-full text-xs" popupClassName="w-64 max-h-72" />
        </div>
        <div className="flex shrink-0 flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">{t(config.type === 'pie' ? 'chart.metric' : 'chart.metrics')}</span>
          {config.type === 'pie' ? (
            <SearchableSelect key="pie" value={data.metrics[0] ?? ''} options={options}
              matches={matchesField} onChange={(pieMetric) => onChange({ ...config, pieMetric })}
              triggerContent={<span className="truncate px-2">{data.metrics[0] || t('chart.selectField')}</span>}
              placeholder={t('result.searchFields')} emptyMessage={t('result.noMatchingFields')}
              aria-label={t('chart.metric')}
              className="h-8 w-full text-xs" popupClassName="w-64 max-h-72" />
          ) : (
            <SearchableSelect key="metrics" multiple value={config.metrics} options={options}
              matches={matchesField} onChange={(metrics) => onChange({ ...config, metrics })}
              triggerContent={<span className="truncate px-2">{config.metrics.join(', ') || t('chart.selectField')}</span>}
              placeholder={t('result.searchFields')} emptyMessage={t('result.noMatchingFields')}
              aria-label={t('chart.metrics')}
              className="h-8 w-full text-xs" popupClassName="w-64 max-h-72" />
          )}
        </div>
        <Button variant="ghost" size="sm" className="mt-auto shrink-0" disabled={!ready || !!error} onClick={exportPng}>
          <Download size={14} aria-hidden="true" />
          {t('chart.exportPng')}
        </Button>
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 flex-wrap gap-x-4 gap-y-1 px-4 py-2 text-xs text-muted-foreground" aria-live="polite">
          <span data-chart-scope="">{t(chartHasCompleteResult(result) ? 'chart.complete' : 'chart.page', { count: docs.length })}</span>
          {options.length > 100 && <span>{t('chart.fieldLimit')}</span>}
          {ready && data.invalid > 0 && <span>{t('chart.invalid', { count: data.invalid })}</span>}
          {ready && data.approximate > 0 && <span>{t('chart.approximate')}</span>}
        </div>
        <div className="relative min-h-0 flex-1">
          <div ref={host} className="h-full w-full" role="img" aria-label={t('chart.description', { type: t(`chart.${config.type}`), x: config.dimension, y: data.metrics.join(', ') })} data-chart-type={config.type} data-chart-points={ready && !error ? data.points.length : 0} />
          {message && <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-muted-foreground" role="status">{message}</div>}
        </div>
      </div>
    </div>
  )
}
