import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  DataOpResult,
  ExportDirectorySelection,
  ExportFileRequest,
  ExportFormat,
  TabularDelimiter,
  TabularExportFormat
} from '@shared/types'
import { exportFileExtension, sanitizeExportBaseName } from '@shared/exportDestination'
import { Modal } from '@renderer/components/common/Modal'
import { Button } from '@renderer/components/common/Button'
import { Input } from '@renderer/components/ui/Input'
import { Select } from '@renderer/components/ui/Select'
import { Tooltip } from '@renderer/components/ui/Tooltip'
import { tabularExportDefaults } from '@renderer/lib/exportDefaults'
import { isMacPlatform } from '@renderer/lib/keyboardShortcuts'
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

function defaultExportFileName(source: ExportModalSource): string {
  return sanitizeExportBaseName(
    source.kind === 'collection' ? source.collection : (source.suggestedName ?? source.collection ?? 'result')
  )
}

export function ExportModal({ source, initialFormat, onClose }: ExportModalProps): React.JSX.Element {
  const { t } = useTranslation()
  const platformDefaults = tabularExportDefaults()
  const chooseExportDirectory = useAppStore((state) => state.chooseExportDirectory)
  const exportCollection = useAppStore((state) => state.exportCollection)
  const cancelExport = useAppStore((state) => state.cancelExport)
  const openExportedFile = useAppStore((state) => state.openExportedFile)
  const revealExportedFile = useAppStore((state) => state.revealExportedFile)
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
  const [directory, setDirectory] = useState<ExportDirectorySelection | null>(null)
  const [fileName, setFileName] = useState(() => defaultExportFileName(source))
  const [choosingDirectory, setChoosingDirectory] = useState(false)
  const [running, setRunning] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [result, setResult] = useState<DataOpResult | null>(null)
  const [fileAction, setFileAction] = useState<'open' | 'reveal' | null>(null)
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
  const canChooseRange = rangeOptions.filter((option) => !('disabled' in option) || !option.disabled).length > 1
  const count = source.kind === 'collection' || scope === 'collection' ? null : resultDocuments.length
  const scopeLabel =
    source.kind === 'collection' || scope === 'collection'
      ? t('io.entireCollection')
      : t(scope === 'selection' ? 'io.selectedCount' : 'io.currentCount', {
          count: count ?? 0
        })

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

  const onChooseDirectory = async (): Promise<void> => {
    if (choosingDirectory || running) return
    setChoosingDirectory(true)
    try {
      const selection = await chooseExportDirectory()
      if (selection) {
        setDirectory(selection)
        setResult(null)
      }
    } finally {
      setChoosingDirectory(false)
    }
  }

  const onExport = async (): Promise<void> => {
    if (!directory || !fileName.trim()) return
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
      fieldSort,
      destination: {
        directorySelectionId: directory.selectionId,
        fileName
      }
    }
    let request: ExportFileRequest
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
        documents: resultDocuments
      }
    } else return

    const response = await exportCollection(request)
    setRunning(false)
    setStopping(false)
    setResult(response)
    if (closeAfterCancel.current) onClose()
  }

  const openResultFile = async (): Promise<void> => {
    if (!taskId || fileAction) return
    setFileAction('open')
    try {
      await openExportedFile(taskId)
    } finally {
      setFileAction(null)
    }
  }

  const revealResultFile = async (): Promise<void> => {
    if (!taskId || fileAction) return
    setFileAction('reveal')
    try {
      await revealExportedFile(taskId)
    } finally {
      setFileAction(null)
    }
  }

  const success = result?.ok === true
  const extension = exportFileExtension(
    format,
    source.kind === 'collection' && format === 'bson' && gzip
  )
  const revealFileLabel = isMacPlatform()
    ? t('io.revealExportedFileInFinder')
    : t('io.revealExportedFileInFileManager')
  const progressPercent =
    progress?.total && progress.total > 0 ? Math.min(100, (progress.processed / progress.total) * 100) : null

  return (
    <Modal
      title={t('io.exportTitle')}
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
            <Button
              variant="primary"
              disabled={!directory || !fileName.trim() || choosingDirectory}
              onClick={() => void onExport()}
            >
              {t('io.exportBtn')}
            </Button>
          )}
        </>
      }
    >
      <div className="mb-4 rounded-lg border border-[var(--separator)] bg-[var(--surface-subtle)] px-3 py-2.5">
        <div className="text-sm font-medium text-foreground">{sourceLabel}</div>
        {!canChooseRange && (
          <div className="mt-0.5 text-xs text-muted-foreground">
            {t('io.range')} · {scopeLabel}
          </div>
        )}
      </div>

      {canChooseRange && (
        <div className="form-row">
          <label>{t('io.range')}</label>
          <Select value={scope} onChange={setScope} options={rangeOptions} aria-label={t('io.range')} />
        </div>
      )}

      <section className="mb-5" aria-labelledby="export-format-heading">
        <h3 id="export-format-heading" className="mb-2 text-xs font-medium text-muted-foreground">
          {t('io.fileFormat')}
        </h3>
        <Select value={format} onChange={onFormatChange} options={formats} aria-label={t('io.format')} />
      </section>

      <section className="mb-4" aria-labelledby="export-destination-heading">
        <h3 id="export-destination-heading" className="mb-2 text-xs font-medium text-muted-foreground">
          {t('io.destination')}
        </h3>
        <div className="form-row mb-3">
          <label htmlFor="export-directory">{t('io.exportDirectory')}</label>
          <div className="flex min-w-0 items-center gap-2">
            <Input
              id="export-directory"
              className="min-w-0 flex-1 font-mono text-xs"
              value={directory?.path ?? ''}
              title={directory?.path}
              placeholder={t('io.exportDirectoryPlaceholder')}
              readOnly
            />
            <Button
              type="button"
              className="h-[38px] shrink-0"
              busy={choosingDirectory}
              disabled={running}
              onClick={() => void onChooseDirectory()}
            >
              {t('io.chooseExportDirectory')}
            </Button>
          </div>
        </div>

        <div className="form-row mb-0">
          <label htmlFor="export-file-name">{t('io.exportFileName')}</label>
          <div className="flex min-w-0 items-center">
            <Input
              id="export-file-name"
              className="min-w-0 flex-1 rounded-r-none"
              value={fileName}
              disabled={running}
              onChange={(event) => {
                setFileName(event.target.value.replace(/[\\/:*?"<>|\0]/g, '-'))
                setResult(null)
              }}
              onBlur={() => setFileName(sanitizeExportBaseName(fileName))}
            />
            <span className="flex h-[38px] shrink-0 items-center rounded-r-[var(--radius-control)] border-l border-[var(--separator)] bg-[var(--surface-control)] px-3 font-mono text-xs text-muted-foreground">
              .{extension}
            </span>
          </div>
        </div>
      </section>

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
            count: result.count ?? 0
          })}
          {result.filePath && (
            <div className="mt-1 flex min-w-0 items-center gap-2">
              <Tooltip content={t('io.openExportedFile')}>
                <button
                  type="button"
                  className="min-w-0 cursor-pointer truncate border-0 bg-transparent p-0 text-left font-[inherit] text-[inherit] underline decoration-transparent underline-offset-2 outline-none transition-[text-decoration-color] hover:decoration-current focus-visible:rounded-sm focus-visible:decoration-current focus-visible:shadow-[0_0_0_3px_var(--focus-soft)] disabled:cursor-default disabled:opacity-60"
                  aria-label={`${t('io.openExportedFile')}: ${result.filePath}`}
                  disabled={fileAction !== null}
                  onClick={() => void openResultFile()}
                >
                  {result.filePath}
                </button>
              </Tooltip>
              <Button
                type="button"
                size="sm"
                className="shrink-0"
                busy={fileAction === 'reveal'}
                disabled={fileAction !== null}
                onClick={() => void revealResultFile()}
              >
                {revealFileLabel}
              </Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
