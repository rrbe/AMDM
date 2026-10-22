import { useEffect, useMemo, useRef, useState } from 'react'
import { EJSON, serialize } from 'bson'
import { useTranslation } from 'react-i18next'
import type {
  DataOpResult,
  ExportDirectorySelection,
  ExportFileRequest,
  ExportFormat,
  JsonEncoding,
  ResultExportFormat,
  TabularDelimiter
} from '@shared/types'
import { exportFileExtension, sanitizeExportBaseName } from '@shared/exportDestination'
import { Modal } from '@renderer/components/common/Modal'
import { Button } from '@renderer/components/common/Button'
import { Input } from '@renderer/components/ui/Input'
import { Select } from '@renderer/components/ui/Select'
import { Radio, RadioGroup } from '@renderer/components/ui/RadioGroup'
import { jsonFormatExamples } from '@renderer/lib/jsonFormatExamples'
import { toEncodedJsonArray, toEncodedJsonLines } from '@renderer/lib/resultCopy'
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
  initialJsonEncoding?: JsonEncoding
  onClose: () => void
}

function newTaskId(): string {
  return globalThis.crypto.randomUUID()
}

function defaultExportFileName(source: ExportModalSource): string {
  const now = new Date()
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const name = source.kind === 'collection' ? source.collection : (source.suggestedName ?? source.collection ?? 'result')
  return `${sanitizeExportBaseName(name)}-${date}`
}

export function ExportModal({
  source,
  initialFormat,
  initialJsonEncoding,
  onClose
}: ExportModalProps): React.JSX.Element {
  const { t } = useTranslation()
  const platformDefaults = tabularExportDefaults()
  const chooseExportDirectory = useAppStore((state) => state.chooseExportDirectory)
  const exportCollection = useAppStore((state) => state.exportCollection)
  const cancelExport = useAppStore((state) => state.cancelExport)
  const openExportedFile = useAppStore((state) => state.openExportedFile)
  const revealExportedFile = useAppStore((state) => state.revealExportedFile)
  const clearExportProgress = useAppStore((state) => state.clearExportProgress)
  const fieldSort = useAppStore((state) => state.settings.resultFieldSort)

  const initialExportFormat = initialFormat ?? 'json'
  const [format, setFormat] = useState<ExportFormat>(initialExportFormat)
  const [jsonEncoding, setJsonEncoding] = useState<JsonEncoding>(initialJsonEncoding ?? 'plain')
  const [scope, setScope] = useState<'collection' | 'current' | 'selection'>(
    source.kind === 'collection' ? 'collection' : source.fixedSelection ? 'selection' : 'current'
  )
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

  useEffect(() => {
    let cancelled = false
    void chooseExportDirectory(true).then((selection) => {
      if (!cancelled) setDirectory(selection)
    })
    return () => { cancelled = true }
  }, [chooseExportDirectory])

  useEffect(
    () => () => {
      if (taskId) clearExportProgress(taskId)
    },
    [clearExportProgress, taskId]
  )

  const isTabular = format === 'csv' || format === 'tsv' || format === 'xlsx'
  const isJson = format === 'json' || format === 'jsonl'
  const bsonExample = useMemo(() => {
    if (format !== 'bson') return ''
    const bytes = serialize(EJSON.deserialize(jsonFormatExamples[0], { relaxed: false }))
    const lines: string[] = []
    for (let offset = 0; offset < bytes.length; offset += 16) {
      const hex = Array.from(bytes.subarray(offset, offset + 16), (byte) => byte.toString(16).padStart(2, '0')).join(' ')
      lines.push(`${offset.toString(16).padStart(4, '0')}  ${hex}`)
    }
    return lines.join('\n')
  }, [format])
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
  const formats = [
    { value: 'json', label: 'JSON' },
    { value: 'csv', label: 'CSV' },
    { value: 'tsv', label: 'TSV' },
    { value: 'xlsx', label: 'Excel' },
    { value: 'bson', label: 'BSON' }
  ] satisfies Array<{ value: ExportFormat; label: string }>
  const jsonEncodings = ['plain', 'relaxed', 'canonical'] as const
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
            }
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
      jsonEncoding: isJson ? jsonEncoding : undefined,
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
        gzip: source.kind === 'collection' && format === 'bson' ? gzip : undefined
      }
    } else if (source.kind === 'result') {
      request = {
        ...common,
        source: 'result',
        format: format as ResultExportFormat,
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
      onClose={requestClose}
      size="lg"
      titleMeta={source.database && source.collection ? `${sourceLabel} · ${scopeLabel}` : scopeLabel}
      className="h-[640px]"
      bodyClassName="flex-1"
      footer={
        <div className="w-full">
          <section className="mb-4" aria-label={t('io.destination')}>
            <div className="mb-3 grid grid-cols-[140px_minmax(0,1fr)] [&>label]:whitespace-nowrap items-center gap-3">
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

            <div className="grid grid-cols-[140px_minmax(0,1fr)] [&>label]:whitespace-nowrap items-center gap-3">
              <label htmlFor="export-file-name">{t('io.exportFileName')}</label>
              <div className="group flex min-w-0 items-center rounded-[var(--radius-control)] border border-transparent bg-[var(--surface-control)] transition-[border-color,background-color,box-shadow] hover:bg-[var(--surface-chrome)] focus-within:border-[var(--separator-strong)] focus-within:bg-[var(--surface-elevated)] focus-within:shadow-[0_0_0_3px_var(--focus-soft)]">
                <Input
                  id="export-file-name"
                  className="h-9 min-w-0 flex-1 border-0 bg-transparent hover:bg-transparent focus-visible:bg-transparent focus-visible:[outline:none] focus-visible:shadow-none"
                  value={fileName}
                  disabled={running}
                  onChange={(event) => {
                    setFileName(event.target.value.replace(/[\\/:*?"<>|\0]/g, '-'))
                    setResult(null)
                  }}
                  onBlur={() => setFileName(sanitizeExportBaseName(fileName))}
                />
                <span className="flex h-9 shrink-0 items-center border-l border-[var(--separator)] px-3 font-mono text-xs text-muted-foreground group-has-[:disabled]:opacity-55">
                  .{extension}
                </span>
              </div>
            </div>
          </section>

          <div className="flex items-center justify-end gap-2">
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
          </div>
        </div>
      }
    >
      {canChooseRange && (
        <div className="mb-4 grid grid-cols-[140px_minmax(0,1fr)] [&>label]:whitespace-nowrap items-center gap-3">
          <label>{t('io.range')}</label>
          <Select disabled={running} value={scope} onChange={setScope} options={rangeOptions} aria-label={t('io.range')} />
        </div>
      )}

      <section className="mb-4" aria-label={t('io.fileFormat')}>
        <RadioGroup<ExportFormat>
          value={isJson ? 'json' : format}
          onValueChange={onFormatChange}
          disabled={running}
          aria-label={t('io.format')}
          className="flex gap-2"
        >
          {formats.map((option) => (
            <Radio key={option.value} value={option.value} render={<button type="button" />} nativeButton
              className="flex-1 cursor-pointer rounded-md border-0 bg-[var(--surface-control)] px-3 py-2 text-[12px] text-muted-foreground outline-none hover:bg-[var(--interaction-hover)] focus-visible:shadow-[0_0_0_3px_var(--focus-soft)] data-[checked]:bg-[var(--interaction-pressed)] data-[checked]:text-foreground data-[checked]:font-semibold">
              {option.label}
            </Radio>
          ))}
        </RadioGroup>
      </section>

      {isJson && (
        <section className="flex flex-col gap-3">
          <div className="grid grid-cols-[140px_minmax(0,1fr)] [&>label]:whitespace-nowrap items-center gap-3">
            <span className="whitespace-nowrap text-xs text-muted-foreground">{t('result.advancedCopy.layout')}</span>
            <RadioGroup<ExportFormat> value={format} onValueChange={onFormatChange} disabled={running}
              aria-label={t('result.advancedCopy.layout')} className="flex gap-4">
              {(['json', 'jsonl'] as const).map((value) => (
                <Radio key={value} value={value} render={<button type="button" />} nativeButton
                  className="flex cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-1 py-1 text-xs text-foreground outline-none focus-visible:shadow-[0_0_0_3px_var(--focus-soft)]">
                  <span aria-hidden className="flex size-3.5 items-center justify-center rounded-full border border-[var(--separator-strong)]">
                    {format === value && <span className="size-2 rounded-full bg-current" />}
                  </span>
                  {value === 'json' ? 'JSON' : 'JSONL'}
                </Radio>
              ))}
            </RadioGroup>
          </div>
          <div className="grid grid-cols-[140px_minmax(0,1fr)] [&>label]:whitespace-nowrap items-center gap-3">
            <span className="whitespace-nowrap text-xs text-muted-foreground">{t('io.jsonEncoding')}</span>
            <RadioGroup<JsonEncoding> value={jsonEncoding} onValueChange={setJsonEncoding} disabled={running}
              aria-label={t('io.jsonEncoding')} className="flex flex-wrap gap-4">
              {jsonEncodings.map((value) => (
                <Tooltip key={value} content={`${t(`result.advancedCopy.${value}.usage`)} ${t(`result.advancedCopy.${value}.types`)}`}>
                <Radio value={value} render={<button type="button" />} nativeButton
                  className="flex cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-1 py-1 text-xs text-foreground outline-none focus-visible:shadow-[0_0_0_3px_var(--focus-soft)]">
                  <span aria-hidden className="flex size-3.5 items-center justify-center rounded-full border border-[var(--separator-strong)]">
                    {jsonEncoding === value && <span className="size-2 rounded-full bg-current" />}
                  </span>
                  {t(`result.advancedCopy.${value}.name`)}
                </Radio>
                </Tooltip>
              ))}
            </RadioGroup>
          </div>
          <div className="mt-1">
            <div className="mb-1 text-xs text-muted-foreground">{t('result.advancedCopy.example')}</div>
            <pre className="m-0 box-border h-[200px] overflow-auto rounded-md bg-[var(--surface-inset)] p-3 font-mono text-[11px] leading-relaxed">
              {format === 'json'
                ? toEncodedJsonArray(jsonFormatExamples.slice(0, 1), jsonEncoding)
                : toEncodedJsonLines(jsonFormatExamples, jsonEncoding)}
            </pre>
          </div>
        </section>
      )}

      {format === 'bson' && (
        <section>
          <div className="mb-1 text-xs text-muted-foreground">{t('io.bsonExample')}</div>
          <pre className="m-0 box-border h-[200px] overflow-auto rounded-md bg-[var(--surface-inset)] p-3 font-mono text-[11px] leading-relaxed">{bsonExample}</pre>
        </section>
      )}

      {isTabular && (
        <div className="mb-4 grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-[var(--separator)] p-3">
          <label className="io-check">
            <input
              type="checkbox"
              disabled={running}
              checked={includeHeader}
              onChange={(event) => setIncludeHeader(event.target.checked)}
            />
            <span>{t('io.includeHeader')}</span>
          </label>
          {(format === 'csv' || format === 'tsv') && (
            <label className="io-check">
              <input type="checkbox" disabled={running} checked={utf8Bom} onChange={(event) => setUtf8Bom(event.target.checked)} />
              <span>{t('io.utf8Bom')}</span>
            </label>
          )}
          {(format === 'csv' || format === 'tsv') && (
            <div className="col-span-2 grid grid-cols-[max-content_15rem] items-center gap-x-3 gap-y-3 text-sm text-foreground">
              <label className="whitespace-nowrap" htmlFor="export-delimiter">
                {t('io.delimiter')}
              </label>
              <Select
                disabled={running}
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
                disabled={running}
                id="export-line-ending"
                value={lineEnding}
                onChange={setLineEnding}
                options={lineEndings}
                aria-label={t('io.lineEnding')}
              />
            </div>
          )}
          {format === 'xlsx' && (
            <label className="col-span-2 grid grid-cols-[140px_minmax(0,1fr)] items-center gap-3 text-xs font-normal text-muted-foreground">
              <span className="whitespace-nowrap">{t('io.worksheetName')}</span>
              <Input
                className="min-w-0 text-[13px] font-normal"
                disabled={running}
                maxLength={64}
                value={worksheetName}
                onChange={(event) => setWorksheetName(event.target.value)}
              />
            </label>
          )}
        </div>
      )}

      {source.kind === 'collection' && (
        <>
          <div className="form-row">
            <label htmlFor="export-query">{t('io.queryFilter')}</label>
            <textarea
              disabled={running}
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
              disabled={running}
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
            <input type="checkbox" disabled={running} checked={gzip} onChange={(event) => setGzip(event.target.checked)} />
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
