import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Copy, Maximize2, Minimize2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { QUERY_LIMITS, type ShellResult, type TabularExportFormat } from '@shared/types'
import { useAppStore, getActiveTab, getActiveResult, type ResultView } from '@renderer/store/useAppStore'
import { resultTabLabel, type ResultTab } from '@renderer/lib/tabs'
import { formatQueryTime } from '@renderer/lib/queryTime'
import { docActionContext } from '@renderer/lib/docActions'
import { copyText, toCsv, toPlainJson, toShellText, toStrictEjson, toTsv } from '@renderer/lib/resultCopy'
import { consoleText } from '@renderer/lib/consoleOutput'
import { selectedIndexesInOrder } from '@renderer/lib/selection'
import { ContextMenu } from '@renderer/components/ContextMenu'
import { DocumentTab } from '@renderer/components/common/DocumentTab'
import { Select } from '@renderer/components/ui/Select'
import { Tooltip } from '@renderer/components/ui/Tooltip'
import { ExportModal } from '@renderer/components/io/ExportModal'
import {
  hasOpenShortcutLayer,
  isAppShortcutEnabled,
  isMacPlatform,
  primaryDigitIndex
} from '@renderer/lib/keyboardShortcuts'
import { TreeView } from './TreeView'
import { JsonView } from './JsonView'
import { TableView } from './TableView'
import { ExplainView } from './ExplainView'
import { ConsoleView } from './ConsoleView'

const QUERY_LIMIT_OPTIONS = QUERY_LIMITS.map((value) => ({
  label: String(value),
  value
}))

/**
 * Result-tab strip (one tab per run) + view switcher (Tree | JSON | Table, plus
 * Console when the run printed output) + metadata bar for the focused result.
 * Handles every ShellResult.kind: 'documents', 'value', 'ack', 'explain',
 * 'error'. A run whose only product is its output (final value null/undefined)
 * lands on Console automatically; a run with a real result keeps the data view
 * and offers Console alongside.
 */
export function ResultPanel({
  expanded,
  onExpandedChange,
  showTabShortcutHints
}: {
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
  showTabShortcutHints: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const results = useAppStore((s) => getActiveTab(s).results)
  const active = useAppStore((s) => getActiveResult(s))
  const result = active?.result ?? null
  const view = useAppStore((s) => s.resultView)
  const fieldSort = useAppStore((s) => s.settings.collectionSort)
  const dataFontSize = useAppStore((s) => s.settings.dataFontSize)
  const keyboardShortcutsEnabled = useAppStore((s) => s.settings.keyboardShortcutsEnabled)
  const disabledKeyboardShortcuts = useAppStore((s) => s.settings.disabledKeyboardShortcuts)
  const setView = useAppStore((s) => s.setResultView)
  const docCtx = docActionContext(result, active?.query ?? null)
  // Anchor for the "copy all" format dropdown (null = closed).
  const [copyMenu, setCopyMenu] = useState<{ x: number; y: number } | null>(null)
  const [selectedDocIndexes, setSelectedDocIndexes] = useState<Set<number>>(() => new Set())
  const [tableDocumentOrder, setTableDocumentOrder] = useState<number[] | null>(null)
  const updateTableDocumentOrder = useCallback((next: number[]) => {
    setTableDocumentOrder((current) =>
      current?.length === next.length && current.every((sourceIndex, index) => sourceIndex === next[index])
        ? current
        : next
    )
  }, [])
  const [exportModal, setExportModal] = useState<{
    format: TabularExportFormat
    fixedDocuments?: unknown[]
  } | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const copiedTimer = useRef<number | null>(null)
  const copyAttempt = useRef(0)
  const copyButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(
    () => () => {
      copyAttempt.current += 1
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current)
    },
    []
  )

  const hasOutput = !!result?.output?.length
  // Scripts that only print (REPL completion value null/undefined) open on
  // Console; everything else opens on the data view with Console one click away.
  const autoConsole = hasOutput && result!.kind === 'value' && result!.data == null
  // The user's explicit Console-vs-data choice, per result tab (so switching
  // result tabs restores each one's view). Pruned to live ids on update.
  const [consoleChoice, setConsoleChoice] = useState<Record<string, boolean>>({})
  const showConsole = hasOutput && !!active && (consoleChoice[active.id] ?? autoConsole)
  const copyFeedbackKey = `${active?.id ?? ''}:${result?.kind === 'error' ? 'error' : showConsole ? 'console' : view}`
  const copied = copiedKey === copyFeedbackKey
  const copyWithFeedback = (text: string): void => {
    const attempt = ++copyAttempt.current
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current)
    copiedTimer.current = null
    setCopiedKey(null)
    void copyText(text).then((ok) => {
      if (!ok || attempt !== copyAttempt.current) return
      setCopiedKey(copyFeedbackKey)
      copiedTimer.current = window.setTimeout(() => {
        setCopiedKey(null)
        copiedTimer.current = null
      }, 1500)
    })
  }
  const chooseConsole = (on: boolean): void => {
    if (!active) return
    setConsoleChoice((prev) => {
      const next: Record<string, boolean> = { [active.id]: on }
      for (const r of results) if (r.id in prev && r.id !== active.id) next[r.id] = prev[r.id]
      return next
    })
  }

  // Cmd+1/2/3 on macOS (Ctrl elsewhere) switches Tree/JSON/Table, with 4 for
  // Console when present. macOS Ctrl+number is reserved for contextual tabs.
  // while the switcher is showing (a documents/value result, not error/explain).
  const switchable = !!result && result.kind !== 'error' && result.kind !== 'explain'
  useEffect(() => {
    if (!switchable || !isAppShortcutEnabled(keyboardShortcutsEnabled, disabledKeyboardShortcuts, 'resultView')) return
    const views: ResultView[] = ['tree', 'json', 'table']
    const onKey = (e: KeyboardEvent): void => {
      if (hasOpenShortcutLayer()) return
      const index = primaryDigitIndex(e, isMacPlatform())
      if (index === 3) {
        if (!hasOutput) return
        e.preventDefault()
        chooseConsole(true)
        return
      }
      const target = index == null ? undefined : views[index]
      if (!target) return
      e.preventDefault()
      chooseConsole(false)
      setView(target)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [switchable, hasOutput, active?.id, setView, disabledKeyboardShortcuts, keyboardShortcutsEnabled])

  useEffect(() => {
    if (!result && expanded) onExpandedChange(false)
  }, [result, expanded, onExpandedChange])

  useEffect(() => {
    setSelectedDocIndexes(new Set())
  }, [active?.id, result?.data])

  useEffect(() => {
    if (view !== 'table') setTableDocumentOrder(null)
  }, [view])

  // One tab per run; the strip only appears once there is something to switch
  // between (a single result reads exactly as before).
  const strip =
    results.length > 1 ? (
      <ResultTabStrip results={results} activeId={active?.id ?? null} showShortcutHints={showTabShortcutHints} />
    ) : null

  if (!result) {
    return (
      <div className="result-panel" data-shortcut-region="result">
        {strip}
        <div className="result-body">
          <div className="center-msg muted">{t('result.noResults')}</div>
        </div>
      </div>
    )
  }

  if (result.kind === 'error') {
    // The output printed before the failure is often the best clue — keep it
    // visible under the error.
    return (
      <div className="result-panel" data-shortcut-region="result">
        {strip}
        <ErrorView
          result={result}
          compact={hasOutput}
          copied={copied}
          onCopy={copyWithFeedback}
          expanded={expanded}
          onExpandedChange={onExpandedChange}
        />
        {hasOutput && (
          <div className="result-body">
            <ConsoleView output={result.output!} fontSize={dataFontSize} truncated={result.outputTruncated} />
          </div>
        )}
      </div>
    )
  }

  // Explain has its own dedicated visualizer; the tree/json/table switcher and
  // doc actions don't apply to it.
  if (result.kind === 'explain') {
    return (
      <div className="result-panel" data-shortcut-region="result">
        {strip}
        <div className="result-bar">
          <span className="explain-tag">{t('result.explainTag')}</span>
          <ResultMeta result={result} docCount={0} executedAt={active!.executedAt} />
          <span className="result-bar-spacer" />
          <ResultExpandButton expanded={expanded} onExpandedChange={onExpandedChange} />
        </div>
        <div className="result-body explain-body">
          <ExplainView plan={result.data} />
        </div>
      </div>
    )
  }

  // Normalize to a documents array for the three views. 'value' / 'ack' get
  // wrapped in a single-element array so the same renderers apply uniformly.
  const docs = normalizeDocs(result)
  const documentOrder = view === 'table' && tableDocumentOrder ? tableDocumentOrder : docs.map((_, index) => index)
  const selectedDocuments = selectedIndexesInOrder(selectedDocIndexes, documentOrder)
    .filter((index) => index >= 0 && index < docs.length)
    .map((index) => docs[index])
  const openSelectionExport = (format: TabularExportFormat, documents: unknown[]): void => {
    setExportModal({ format, fixedDocuments: documents })
  }
  const closeExport = (): void => {
    setExportModal(null)
    window.requestAnimationFrame(() => copyButtonRef.current?.focus())
  }

  return (
    <div className="result-panel" data-shortcut-region="result">
      {strip}
      <div className="result-bar">
        <div className="view-switch">
          {(['tree', 'json', 'table'] as ResultView[]).map((v, i) => {
            const label = v === 'tree' ? t('result.view.tree') : v === 'json' ? 'JSON' : t('result.view.table')
            return (
              <button
                key={v}
                className={!showConsole && view === v ? 'active' : ''}
                onClick={() => {
                  chooseConsole(false)
                  setView(v)
                }}
              >
                {label}
                <span className="text-[0.8em] leading-none font-normal text-muted-foreground">(⌘{i + 1})</span>
              </button>
            )
          })}
          {hasOutput && (
            <Tooltip content="Console (⌘4)">
              <button className={showConsole ? 'active' : ''} onClick={() => chooseConsole(true)}>
                {t('result.view.console')}
              </button>
            </Tooltip>
          )}
        </div>
        <ResultMeta result={result} docCount={docs.length} executedAt={active!.executedAt} />
        <span className="result-bar-spacer" />
        {result.kind === 'documents' && <PageSizeControl />}
        {result.kind === 'documents' && <ResultPager result={result} />}
        <button
          ref={copyButtonRef}
          className="ghost result-action"
          aria-label={copied ? t('notify.copied') : t('result.copyAllTip')}
          onClick={(e) => {
            if (showConsole) {
              copyWithFeedback(consoleText(result.output!))
              return
            }
            const r = e.currentTarget.getBoundingClientRect()
            setCopyMenu({ x: r.left, y: r.bottom + 4 })
          }}
        >
          {copied ? <Check size={14} className="text-[var(--ok)]" /> : <Copy size={14} />}
        </button>
        <ResultExpandButton expanded={expanded} onExpandedChange={onExpandedChange} />
      </div>

      <div className="result-body">
        {showConsole ? (
          <ConsoleView output={result.output!} fontSize={dataFontSize} truncated={result.outputTruncated} />
        ) : (
          <>
            {view === 'tree' && (
              <TreeView
                docs={docs}
                fontSize={dataFontSize}
                selectedDocIndexes={selectedDocIndexes}
                onSelectedDocIndexesChange={setSelectedDocIndexes}
                onExport={openSelectionExport}
                docCtx={docCtx}
              />
            )}
            {view === 'json' && <JsonView value={docs} fontSize={dataFontSize} />}
            {view === 'table' && (
              <TableView
                key={active?.id}
                docs={docs}
                fontSize={dataFontSize}
                selectedDocIndexes={selectedDocIndexes}
                onSelectedDocIndexesChange={setSelectedDocIndexes}
                onDocumentOrderChange={updateTableDocumentOrder}
                onExport={openSelectionExport}
                docCtx={docCtx}
              />
            )}
          </>
        )}
      </div>

      {copyMenu && (
        <ContextMenu
          x={copyMenu.x}
          y={copyMenu.y}
          onClose={() => setCopyMenu(null)}
          items={[
            { label: t('result.copy.pureJson'), onClick: () => copyWithFeedback(toPlainJson(docs)) },
            { label: t('result.copy.mongoShell'), onClick: () => copyWithFeedback(toShellText(docs)) },
            { label: t('result.copy.extendedJson'), onClick: () => copyWithFeedback(toStrictEjson(docs)) },
            { label: t('result.copy.csv'), onClick: () => copyWithFeedback(toCsv(docs, fieldSort)) },
            { label: t('result.copy.tsv'), onClick: () => copyWithFeedback(toTsv(docs, fieldSort)) },
            'separator',
            {
              label: t('result.export.csv'),
              onClick: () => setExportModal({ format: 'csv' })
            },
            {
              label: t('result.export.tsv'),
              onClick: () => setExportModal({ format: 'tsv' })
            },
            {
              label: t('result.export.xlsx'),
              onClick: () => setExportModal({ format: 'xlsx' })
            }
          ]}
        />
      )}
      {exportModal && (
        <ExportModal
          source={{
            kind: 'result',
            documents: exportModal.fixedDocuments ?? docs,
            selectedDocuments: exportModal.fixedDocuments ?? selectedDocuments,
            fixedSelection: exportModal.fixedDocuments != null,
            connectionId: docCtx?.connectionId ?? active?.query?.connectionId,
            database: docCtx?.database ?? active?.query?.database,
            collection: docCtx?.collection,
            suggestedName: docCtx?.collection ? `${docCtx.collection}-result` : 'result'
          }}
          initialFormat={exportModal.format}
          onClose={closeExport}
        />
      )}
    </div>
  )
}

function ResultExpandButton({
  expanded,
  onExpandedChange
}: {
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const label = t(expanded ? 'result.restoreEditor' : 'result.expandResults')
  return (
    <button
      className={`ghost result-action${expanded ? ' is-active' : ''}`}
      aria-label={label}
      aria-pressed={expanded}
      onClick={() => onExpandedChange(!expanded)}
    >
      {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
    </button>
  )
}

/**
 * The result-tab strip: one chip per kept run (newest last), click to focus,
 * ✕ / middle-click to close. New runs always land in a fresh tab (the store
 * caps how many are kept — see lib/tabs MAX_RESULT_TABS).
 */
function ResultTabStrip({
  results,
  activeId,
  showShortcutHints
}: {
  results: ResultTab[]
  activeId: string | null
  showShortcutHints: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const setActiveResultTab = useAppStore((s) => s.setActiveResultTab)
  const closeResultTab = useAppStore((s) => s.closeResultTab)
  const stripRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!activeId) return
    stripRef.current
      ?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(activeId)}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeId])

  return (
    <div ref={stripRef} className="result-tabs">
      {results.map((r, index) => {
        const query = r.query
        return (
          <DocumentTab
            key={r.id}
            active={r.id === activeId}
            className="rtab"
            dataTabId={r.id}
            label={resultTabLabel(r)}
            tooltip={query ? () => <span data-result-tab-query="">{query.code}</span> : undefined}
            tooltipVariant="code"
            closeLabel={t('result.closeTab')}
            onSelect={() => setActiveResultTab(r.id)}
            onClose={() => closeResultTab(r.id)}
            shortcutNumber={showShortcutHints && index < 9 ? index + 1 : undefined}
          />
        )
      })}
    </div>
  )
}

/** Turn any non-error ShellResult into an array of values for the views. */
function normalizeDocs(result: ShellResult): unknown[] {
  if (result.kind === 'documents') {
    return Array.isArray(result.data) ? result.data : []
  }
  // 'value' or 'ack': wrap the single payload (skip undefined).
  return result.data === undefined ? [] : [result.data]
}

function ResultMeta({
  result,
  docCount,
  executedAt
}: {
  result: ShellResult
  docCount: number
  executedAt: number
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const parts = useMemo(() => {
    const out: { text: string; cls?: string }[] = []
    if (result.kind === 'documents') {
      const n = result.count ?? docCount
      out.push({ text: t('result.docCount', { count: n }) })
      // For pageable results the pager shows the range + a next button, so the
      // "truncated" badge would be redundant. Keep it for non-pageable cursors
      // (aggregate / scripts), where raising the page size is the only way on.
      if (result.truncated && !result.pageable) {
        out.push({ text: t('result.truncated'), cls: 'truncated' })
      }
    } else if (result.kind === 'value') {
      out.push({ text: t('result.kindValue') })
    } else if (result.kind === 'ack') {
      out.push({ text: t('result.kindAck') })
    }
    if (result.output?.length) {
      out.push({ text: t('result.outputLines', { count: result.output.length }) })
    }
    if (typeof result.elapsedMs === 'number') {
      out.push({ text: t('result.elapsed', { ms: result.elapsedMs }) })
    }
    const queryTime = formatQueryTime(executedAt, i18n.resolvedLanguage)
    if (queryTime) out.push({ text: queryTime })
    return out
  }, [result, docCount, executedAt, i18n.resolvedLanguage, t])

  return (
    <div className="result-meta">
      {parts.map((p, i) => (
        <span key={i} className="result-meta-part">
          {i > 0 && <span className="result-meta-separator" aria-hidden="true" />}
          <span className={p.cls}>{p.text}</span>
        </span>
      ))}
    </div>
  )
}

/**
 * Prev/next pager. Only a FindCursor is pageable (the engine injects skip);
 * aggregation/script results render no pager (the page-size control is their
 * way to see more). Next is enabled only while the page is truncated.
 */
function ResultPager({ result }: { result: ShellResult }): React.JSX.Element | null {
  const { t } = useTranslation()
  const skip = useAppStore((s) => getActiveResult(s)?.skip ?? 0)
  const limit = useAppStore((s) => s.settings.queryLimit)
  const running = useAppStore((s) => getActiveTab(s).running)
  const loadPage = useAppStore((s) => s.loadPage)

  if (!result.pageable) return null

  const count = result.count ?? 0
  const from = count === 0 ? 0 : skip + 1
  const to = skip + count
  return (
    <div className="result-pager">
      <Tooltip content={t('result.prevPage')}>
        <button
          className="ghost"
          disabled={skip === 0 || running}
          aria-label={t('result.prevPage')}
          onClick={() => void loadPage(Math.max(0, skip - limit))}
        >
          <ChevronLeft size={15} />
        </button>
      </Tooltip>
      <span className="result-range">
        {from}–{to}
      </span>
      <Tooltip content={t('result.nextPage')}>
        <button
          className="ghost"
          disabled={!result.truncated || running}
          aria-label={t('result.nextPage')}
          onClick={() => void loadPage(skip + limit)}
        >
          <ChevronRight size={15} />
        </button>
      </Tooltip>
    </div>
  )
}

/** Query limit control; changing it re-runs the focused result from page one. */
function PageSizeControl(): React.JSX.Element {
  const { t } = useTranslation()
  const limit = useAppStore((s) => s.settings.queryLimit)
  const setQueryLimit = useAppStore((s) => s.setQueryLimit)
  const running = useAppStore((s) => getActiveTab(s).running)

  return (
    <div className="page-size">
      <span>{t('result.pageSizeLabel')}</span>
      <Select<number>
        value={limit}
        options={QUERY_LIMIT_OPTIONS}
        disabled={running}
        onChange={(n) => void setQueryLimit(n)}
        className="h-6 w-[72px] px-2 text-xs"
        aria-label={t('result.pageSizeLabel')}
      />
    </div>
  )
}

function ErrorView({
  result,
  compact,
  copied,
  onCopy,
  expanded,
  onExpandedChange
}: {
  result: ShellResult
  compact?: boolean
  copied: boolean
  onCopy: (text: string) => void
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const name = result.errorName ?? t('result.errorName')
  const message = result.error ?? t('result.errorUnknown')
  return (
    // Compact mode: a banner above the run's console output instead of the
    // full-height body (the output printed before the failure stays visible).
    <div className={compact ? 'result-error-banner' : 'result-body'}>
      <div className="error-panel">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="error-name">{name}</div>
            <div className="error-msg">{message}</div>
          </div>
          <button
            className="ghost result-action shrink-0"
            aria-label={copied ? t('notify.copied') : t('result.copyErrorTip')}
            onClick={() => onCopy(`${name}: ${message}`)}
          >
            {copied ? <Check size={14} className="text-[var(--ok)]" /> : <Copy size={14} />}
          </button>
          <ResultExpandButton expanded={expanded} onExpandedChange={onExpandedChange} />
        </div>
      </div>
    </div>
  )
}
