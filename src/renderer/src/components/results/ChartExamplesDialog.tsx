import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import { useTranslation } from 'react-i18next'
import type { ShellResult } from '@shared/types'
import { Button } from '@renderer/components/common/Button'
import { Modal } from '@renderer/components/common/Modal'
import { FieldSelect } from '@renderer/components/ui/FieldSelect'
import { chartFieldAggregation, chartHasCompleteResult, prepareChart, prepareChartExampleFields, type ResultChartConfig } from '@renderer/lib/resultChart'
import type { ChartViewProps } from './ChartView'

const PATTERNS = ['count', 'sum', 'average'] as const
type Pattern = typeof PATTERNS[number] | 'raw'

const EXAMPLE_FIELDS = ['status', 'paymentMethod', 'amount'] as const
const exampleFields = [...EXAMPLE_FIELDS]
const exampleDocs = [
  { status: 'paid', paymentMethod: 'card', amount: 100 },
  { status: 'paid', paymentMethod: 'transfer', amount: 50 },
  { status: 'pending', paymentMethod: 'card', amount: 80 }
]
const exampleResult: ShellResult = { kind: 'documents', data: exampleDocs, truncated: false }

function patternConfig(pattern: Pattern, dimension: string, metric: string): ResultChartConfig {
  return pattern === 'count'
    ? { type: 'bar', dimension, metrics: [null] }
    : { type: 'bar', dimension, metrics: [metric], aggregations: { [metric]: pattern } }
}

function useExampleFields(docs: unknown[], fields: string[] | undefined, dimension: string, enabled: boolean, grouped = false) {
  const [available, setAvailable] = useState<{ docs: unknown[]; fields: string[]; dimension: string; grouped: boolean; items: string[] }>()
  useEffect(() => {
    if (!enabled || !fields) return
    const controller = new AbortController()
    void prepareChartExampleFields(docs, fields, dimension, controller.signal, grouped).then((items) => {
      if (!controller.signal.aborted) setAvailable({ docs, fields, dimension, grouped, items })
    })
    return () => controller.abort()
  }, [docs, fields, dimension, enabled, grouped])
  return enabled && available?.docs === docs && available.fields === fields && available.dimension === dimension && available.grouped === grouped ? available.items : undefined
}

export function ChartExamplesDialog({ docs, fields, result, Preview, onClose, onApply }: {
  docs: unknown[]
  fields: string[] | undefined
  result: ShellResult
  Preview: ComponentType<ChartViewProps>
  onClose: () => void
  onApply: (config: ResultChartConfig) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [previewConfig, setPreviewConfig] = useState(() => patternConfig('count', 'status', 'amount'))
  const [mapping, setMapping] = useState(false)
  const [dimension, setDimension] = useState('')
  const [metric, setMetric] = useState('')
  const mappingRef = useRef<HTMLDivElement>(null)
  const patternsRef = useRef<HTMLDivElement>(null)
  const previewMetric = previewConfig.metrics[0]
  const pattern = previewMetric == null ? 'count' : chartFieldAggregation(previewConfig, previewMetric)
  const preview = useMemo(() => prepareChart(exampleDocs, previewConfig), [previewConfig])
  const firstPoint = preview.points.find((point) => point.values[0]?.value != null)
  const canMap = !preview.error && !!firstPoint
  const needsMetric = pattern !== 'count'
  const dimensions = useExampleFields(docs, fields, '', mapping)
  const validDimension = dimensions?.includes(dimension) ?? false
  const metrics = useExampleFields(docs, fields, dimension, mapping && needsMetric && validDimension, pattern !== 'raw')
  const validMetric = metrics?.includes(metric) ?? false
  const mappedConfig = useMemo(() => validDimension && (!needsMetric || validMetric)
    ? patternConfig(pattern, dimension, metric) : null, [dimension, metric, needsMetric, pattern, validDimension, validMetric])
  const error = useMemo(() => mappedConfig ? prepareChart(docs, mappedConfig).error : null, [docs, mappedConfig])

  useEffect(() => {
    const target = mapping
      ? mappingRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')
      : patternsRef.current?.querySelector<HTMLButtonElement>('button[aria-pressed=true]')
    target?.focus()
  }, [mapping])

  return (
    <Modal title={t(mapping ? 'chart.examples.mapFields' : 'chart.examples.title')} size="lg" className="h-[640px]" bodyClassName="flex flex-1 flex-col gap-3 px-4 py-3"
      onClose={onClose}
      footer={mapping ? <>
        <Button type="button" variant="ghost" onClick={() => setMapping(false)}>{t('chart.examples.back')}</Button>
        <div className="spacer" />
        <Button type="button" variant="primary" disabled={!mappedConfig || !!error} onClick={() => {
          if (mappedConfig && !error) onApply(mappedConfig)
        }}>{t('chart.examples.apply')}</Button>
      </> : <>
        <div className="spacer" />
        <Button type="button" variant="primary" disabled={!canMap} onClick={() => setMapping(true)}>{t('chart.examples.useResult')}</Button>
      </>}>
      {mapping ? (
        <div ref={mappingRef} className="flex max-w-md flex-col gap-4 px-2 py-2">
          <div className="text-xs text-muted-foreground">{t(chartHasCompleteResult(result) ? 'chart.complete' : 'chart.page', { count: docs.length })}</div>
          <div className="grid grid-cols-[10rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 text-[13px]">
            <span>{t('chart.dimension')}</span>
            <FieldSelect value={validDimension ? dimension : ''} fields={dimensions} label={t('chart.dimension')}
              onChange={(field) => { setDimension(field); setMetric('') }}
              trigger={<Button type="button" className="w-full [&_.busy-btn-label]:min-w-0" disabled={dimensions?.length === 0}
                aria-label={validDimension ? t('chart.changeDimension') : t('chart.addDimension')}>
                <span className="truncate">{validDimension ? dimension : t('chart.addDimension')}</span>
              </Button>} />
            <span>{t('chart.metric')}</span>
            {needsMetric ? <FieldSelect value={validMetric ? metric : ''} fields={metrics} label={t('chart.metric')}
              onChange={setMetric}
              trigger={<Button type="button" className="w-full [&_.busy-btn-label]:min-w-0" disabled={!validDimension || metrics?.length === 0}
                aria-label={validMetric ? t('chart.changeMetric') : t('chart.addMetric')}>
                <span className="truncate">{validMetric ? metric : t('chart.addMetric')} · {t(`chart.aggregation.${pattern}`)}</span>
              </Button>} /> : <span className="px-3">{t('chart.recordCount')}</span>}
          </div>
          <div role="status" className="text-xs text-muted-foreground">
            {dimensions?.length === 0 ? t('chart.examples.noDimension')
              : needsMetric && metrics?.length === 0 ? t('chart.examples.noMetric')
              : error ? t(`chart.${error}`) : null}
          </div>
        </div>
      ) : (
        <>
          <div ref={patternsRef} className="flex shrink-0 flex-wrap gap-1" role="group" aria-label={t('chart.examples.title')}>
            {PATTERNS.map((choice) => (
              <Button key={choice} type="button" size="sm" aria-pressed={canMap && pattern === choice} variant={canMap && pattern === choice ? 'default' : 'ghost'}
                onClick={() => {
                  setPreviewConfig(patternConfig(choice, previewConfig.dimension || 'status', 'amount'))
                }}>
                {t(`chart.examples.${choice}`)}
              </Button>
            ))}
          </div>
          <table aria-label={t('chart.examples.sampleData')} className="w-full shrink-0 border-collapse text-left text-xs [font-family:var(--font-mono)]">
            <thead className="bg-[var(--surface-chrome)] text-muted-foreground">
              <tr>{EXAMPLE_FIELDS.map((field) => <th key={field} scope="col" className="px-3 py-1.5 font-medium">{field}</th>)}</tr>
            </thead>
            <tbody>
              {exampleDocs.map((doc) => (
                <tr key={doc.amount} className="border-b border-[var(--separator)]">
                  {EXAMPLE_FIELDS.map((field) => <td key={field} className="px-3 py-1.5">{doc[field]}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="m-0 min-h-8 shrink-0 text-xs leading-4 text-muted-foreground" aria-live="polite">{canMap && t(`chart.examples.explanation.${pattern}`, { dimension: previewConfig.dimension, metric: previewMetric, group: firstPoint.label, value: firstPoint.values[0].raw })}</p>
          <div className="min-h-60 flex-1 border-t border-[var(--separator)]">
            <Preview sample docs={exampleDocs} fields={exampleFields} result={exampleResult} config={previewConfig} onChange={setPreviewConfig} />
          </div>
        </>
      )}
    </Modal>
  )
}
