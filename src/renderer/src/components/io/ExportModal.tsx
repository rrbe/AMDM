import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  CollectionExportRequest,
  DataOpResult,
  ExportFormat,
  ResultExportRequest,
  TabularDelimiter,
  TabularExportFormat
} from '@shared/types'
import { Modal } from '@renderer/components/common/Modal'
import { Button } from '@renderer/components/common/Button'
import { Select } from '@renderer/components/ui/Select'
import { tabularExportDefaults } from '@renderer/lib/exportDefaults'
import { useAppStore } from '@renderer/store/useAppStore'

export interface CollectionExportSource {
  kind: 'collection'
  connectionId: string
  database: string
  collection: string
}

export interface ResultExportSource {
  kind: 'result'
  documents: unknown[]
  selectedDocuments: unknown[]
  /** Right-click export is fixed to the effective selection under the pointer. */
  fixedSelection?: boolean
  connectionId?: string
  database?: string
  collection?: string
  suggestedName?: string
}

export type ExportModalSource = CollectionExportSource | ResultExportSource

interface ExportModalProps {
  source: ExportModalSource
  initialFormat?: ExportFormat
  onClose: () => void
}

const COLLECTION_FORMATS: Array<{ value: ExportFormat; label: string }> = [
  { value: 'json', label: 'JSON' },
  { value: 'csv', label: 'CSV' },
  { value: 'tsv', label: 'TSV' },
  { value: 'xlsx', label: 'Excel' },
  { value: 'bson', label: 'BSON' }
]

const RESULT_FORMATS = COLLECTION_FORMATS.filter(
  (format): format is { value: TabularExportFormat; label: string } =>
    format.value === 'csv' || format.value === 'tsv' || format.value === 'xlsx'
)

function newTaskId(): string {
  return globalThis.crypto.randomUUID()
}

export function ExportModal({ source, initialFormat, onClose }: ExportModalProps): React.JSX.Element {
  const { t } = useTranslation()
  const platformDefaults = tabularExportDefaults()
  const exportCollection = useAppStore((state) => state.exportCollection)
  const cancelExport = useAppStore((state) => state.cancelExport)
  const clearExportProgress = useAppStore((state) => state.clearExportProgress)
  const fieldSort = useAppStore((state) => state.settings.collectionSort)

  const formats = source.kind === 'collection' ? COLLECTION_FORMATS : RESULT_FORMATS
  const fallbackFormat: ExportFormat = source.kind === 'collection' ? 'json' : 'csv'
  const initialExportFormat = initialFormat ?? fallbackFormat
  const [format, setFormat] = useState<ExportFormat>(initialExportFormat)
  const [scope, setScope] = useState<'collection' | 'current' | 'selection'>(
    source.kind === 'collection' ? 'collection' : source.fixedSelection ? 'selection' : 'current'
  )
  const [jsonArray, setJsonArray] = useState(true)
  const [gzip, setGzip] = useState(false)
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState('')
  const [includeHeader, setIncludeHeader] = useState(true)
  const [utf8Bom, setUtf8Bom] = useState(platformDefaults.utf8Bom)
  const [lineEnding, setLineEnding] = useState<'lf' | 'crlf'>(platformDefaults.lineEnding)
  const [delimiter, setDelimiter] = useState<TabularDelimiter>(initialExportFormat === 'tsv' ? '\t' : ',')
  const [worksheetName, setWorksheetName] = useState(
    source.kind === 'collection' ? source.collection : (source.collection ?? 'Result')
  )
  const [running, setRunning] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [result, setResult] = useState<DataOpResult | null>(null)
  const closeAfterCancel = useRef(false)
  const progress = useAppStore((state) => (taskId ? state.exportProgress[taskId] : undefined))

  useEffect(
    () => () => {
      if (taskId) clearExportProgress(taskId)
    },
    [clearExportProgress, taskId]
  )

  const isTabular = format === 'csv' || format === 'tsv' || format === 'xlsx'
  const selectedCount = source.kind === 'result' ? source.selectedDocuments.length : 0
  const collectionSource =
    source.kind === 'collection'
      ? source
      : source.connectionId && source.database && source.collection
        ? {
            connectionId: source.connectionId,
            database: source.database,
            collection: source.collection
          }
        : null
  const resultDocuments =
    source.kind === 'result'
      ? source.fixedSelection || scope === 'selection'
        ? source.selectedDocuments
        : source.documents
      : []
  const sourceLabel =
    source.kind === 'collection'
      ? `${source.database}.${source.collection}`
      : source.database && source.collection
        ? `${source.database}.${source.collection}`
        : t('io.currentResult')
  const lineEndings = [
    { label: t('io.lineEndingCrlf'), value: 'crlf' },
    { label: t('io.lineEndingLf'), value: 'lf' }
  ] as const
  const delimiters = [
    { label: t('io.delimiterComma'), value: ',' },
    { label: t('io.delimiterSemicolon'), value: ';' },
    { label: t('io.delimiterSpace'), value: ' ' },
    { label: t('io.delimiterTab'), value: '\t' },
    { label: t('io.delimiterSlash'), value: '/' },
    { label: t('io.delimiterHyphen'), value: '-' },
    { label: t('io.delimiterPeriod'), value: '.' }
  ] as const
  const rangeOptions =
    source.kind === 'collection'
      ? [{ label: t('io.entireCollection'), value: 'collection' as const }]
      : source.fixedSelection
        ? [{ label: t('io.selectedCount', { count: selectedCount }), value: 'selection' as const }]
        : [
            { label: t('io.currentCount', { count: source.documents.length }), value: 'current' as const },
            {
              label: t('io.selectedCount', { count: selectedCount }),
              value: 'selection' as const,
              disabled: selectedCount === 0
            },
            { label: t('io.entireCollection'), value: 'collection' as const, disabled: !collectionSource }
          ]

  const stop = async (close: boolean): Promise<void> => {
    if (!taskId || stopping) return
    closeAfterCancel.current = close
    setStopping(true)
    await cancelExport(taskId)
  }

  const requestClose = (): void => {
    if (running) {
      void stop(true)
      return
    }
    onClose()
  }

  const onFormatChange = (nextFormat: ExportFormat): void => {
    if (nextFormat === 'csv') setDelimiter(',')
    if (nextFormat === 'tsv') setDelimiter('\t')
    setFormat(nextFormat)
  }

  const onExport = async (): Promise<void> => {
    const nextTaskId = newTaskId()
    if (taskId) clearExportProgress(taskId)
    setTaskId(nextTaskId)
    setResult(null)
    setRunning(true)
    setStopping(false)
    closeAfterCancel.current = false

    const common = {
      taskId: nextTaskId,
      format,
      includeHeader: isTabular ? includeHeader : undefined,
      utf8Bom: format === 'csv' || format === 'tsv' ? utf8Bom : undefined,
      lineEnding: format === 'csv' || format === 'tsv' ? lineEnding : undefined,
      delimiter: format === 'csv' || format === 'tsv' ? delimiter : undefined,
      worksheetName: format === 'xlsx' ? worksheetName : undefined,
      fieldSort
    }
    let request: CollectionExportRequest | ResultExportRequest
    if (scope === 'collection' && collectionSource) {
      const trimmedQuery = query.trim()
      const parsedLimit = Number.parseInt(limit, 10)
      request = {
        ...common,
        source: 'collection',
        connectionId: collectionSource.connectionId,
        database: collectionSource.database,
        collection: collectionSource.collection,
        query: source.kind === 'collection' && trimmedQuery ? trimmedQuery : undefined,
        limit:
          source.kind === 'collection' && Number.isFinite(parsedLimit) && parsedLimit > 0
            ? parsedLimit
            : undefined,
        jsonArray: source.kind === 'collection' && format === 'json' ? jsonArray : undefined,
        gzip: source.kind === 'collection' && format === 'bson' ? gzip : undefined
      }
    } else if (source.kind === 'result') {
      request = {
        ...common,
        source: 'result',
        format: format as TabularExportFormat,
        documents: resultDocuments,
        suggestedName: source.suggestedName ?? source.collection ?? 'result'
      }
    } else return

    const response = await exportCollection(request)
    setRunning(false)
    setStopping(false)
    setResult(response)
    if (closeAfterCancel.current) onClose()
  }

  const success = result?.ok === true
  const count = source.kind === 'collection' || scope === 'collection' ? null : resultDocuments.length
  const progressPercent =
    progress?.total && progress.total > 0 ? Math.min(100, (progress.processed / progress.total) * 100) : null

  return (
    <Modal
      title={t('io.exportTitle', { target: sourceLabel })}
      description={t('io.exportDescription')}
      onClose={requestClose}
      lockTop
      footer={
        <>
          <span className="spacer" />
          <Button onClick={requestClose} disabled={stopping}>
            {running ? t('io.closeAndStop') : t('io.close')}
          </Button>
          {running ? (
            <Button variant="primary" busy={stopping} onClick={() => void stop(false)}>
              {t('io.stop')}
            </Button>
          ) : (
            <Button variant="primary" onClick={() => void onExport()}>
              {success ? t('io.exportAgain') : t('io.exportBtn')}
            </Button>
          )}
        </>
      }
    >
      <div className="mb-4 rounded-lg border border-[var(--separator)] bg-[var(--surface-subtle)] px-3 py-2.5">
        <div className="text-sm font-medium text-foreground">{sourceLabel}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {source.kind === 'collection' || scope === 'collection'
            ? t('io.entireCollection')
            : t(scope === 'selection' ? 'io.selectedCount' : 'io.currentCount', {
                count: count ?? 0
              })}
        </div>
      </div>

      <div className="form-row">
        <label>{t('io.range')}</label>
        <Select
          value={scope}
          onChange={setScope}
          options={rangeOptions}
          disabled={rangeOptions.length === 1}
          aria-label={t('io.range')}
        />
      </div>

      <div className="form-row">
        <label>{t('io.format')}</label>
        <Select value={format} onChange={onFormatChange} options={formats} aria-label={t('io.format')} />
      </div>

      {isTabular && (
        <div className="mb-4 grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-[var(--separator)] p-3">
          <label className="io-check">
            <input
              type="checkbox"
              checked={includeHeader}
              onChange={(event) => setIncludeHeader(event.target.checked)}
            />
            <span>{t('io.includeHeader')}</span>
          </label>
          {(format === 'csv' || format === 'tsv') && (
            <label className="io-check">
              <input type="checkbox" checked={utf8Bom} onChange={(event) => setUtf8Bom(event.target.checked)} />
              <span>{t('io.utf8Bom')}</span>
            </label>
          )}
          {(format === 'csv' || format === 'tsv') && (
            <div className="col-span-2 grid grid-cols-[max-content_15rem] items-center gap-x-3 gap-y-3 text-sm text-foreground">
              <label className="whitespace-nowrap" htmlFor="export-delimiter">
                {t('io.delimiter')}
              </label>
              <Select
                id="export-delimiter"
                value={delimiter}
                onChange={setDelimiter}
                options={delimiters}
                aria-label={t('io.delimiter')}
              />
              <label className="whitespace-nowrap" htmlFor="export-line-ending">
                {t('io.lineEnding')}
              </label>
              <Select
                id="export-line-ending"
                value={lineEnding}
                onChange={setLineEnding}
                options={lineEndings}
                aria-label={t('io.lineEnding')}
              />
            </div>
          )}
          {format === 'xlsx' && (
            <label className="col-span-2 flex items-center gap-2 text-sm text-foreground">
              <span>{t('io.worksheetName')}</span>
              <input
                className="min-w-0 flex-1"
                maxLength={64}
                value={worksheetName}
                onChange={(event) => setWorksheetName(event.target.value)}
              />
            </label>
          )}
        </div>
      )}

      {source.kind === 'collection' && format === 'json' && (
        <div className="form-row">
          <label className="io-check">
            <input type="checkbox" checked={jsonArray} onChange={(event) => setJsonArray(event.target.checked)} />
            <span>{t('io.jsonArray')}</span>
          </label>
        </div>
      )}

      {source.kind === 'collection' && (
        <>
          <div className="form-row">
            <label htmlFor="export-query">{t('io.queryFilter')}</label>
            <textarea
              id="export-query"
              className="io-query"
              spellCheck={false}
              placeholder="{}"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="form-row">
            <label htmlFor="export-limit">{t('io.limit')}</label>
            <input
              id="export-limit"
              type="number"
              min={1}
              placeholder={t('io.limitPlaceholder')}
              value={limit}
              onChange={(event) => setLimit(event.target.value)}
            />
          </div>
        </>
      )}

      {source.kind === 'collection' && format === 'bson' && (
        <div className="form-row">
          <label className="io-check">
            <input type="checkbox" checked={gzip} onChange={(event) => setGzip(event.target.checked)} />
            <span>{t('io.gzip')}</span>
          </label>
        </div>
      )}

      {running && progress && (
        <div className="io-result">
          <div className="flex items-center justify-between gap-3">
            <span>{t(`io.progress.${progress.phase}`)}</span>
            <span>
              {progress.total == null
                ? t('io.processedCount', { count: progress.processed })
                : `${progress.processed} / ${progress.total}`}
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-sunken)]">
            <div
              className={`h-full rounded-full bg-[var(--accent)] transition-[width]${progressPercent == null ? ' w-1/3 animate-pulse' : ''}`}
              style={progressPercent == null ? undefined : { width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}
      {result?.cancelled && <div className="io-result">{t('io.exportCancelled')}</div>}
      {result && !result.ok && !result.cancelled && (
        <div className="io-result err">{result.error ?? t('io.exportFailed')}</div>
      )}
      {success && (
        <div className="io-result ok">
          {t('io.exportSuccess', {
            count: result.count ?? 0,
            path: result.filePath ?? ''
          })}
        </div>
      )}
    </Modal>
  )
}
