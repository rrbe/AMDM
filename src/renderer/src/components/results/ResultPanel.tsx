import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Copy, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ShellResult } from '@shared/types'
import { useAppStore, getActiveTab, getActiveResult, type ResultView } from '@renderer/store/useAppStore'
import { resultTabLabel, type ResultTab } from '@renderer/lib/tabs'
import { docActionContext } from '@renderer/lib/docActions'
import { copyText, toCsv, toPlainJson, toShellText, toStrictEjson, toTsv } from '@renderer/lib/resultCopy'
import { ContextMenu } from '@renderer/components/ContextMenu'
import { TreeView } from './TreeView'
import { JsonView } from './JsonView'
import { TableView } from './TableView'
import { ExplainView } from './ExplainView'
import { ConsoleView } from './ConsoleView'

/**
 * Result-tab strip (one tab per run) + view switcher (Tree | JSON | Table, plus
 * Console when the run printed output) + metadata bar for the focused result.
 * Handles every ShellResult.kind: 'documents', 'value', 'ack', 'explain',
 * 'error'. A run whose only product is its output (final value null/undefined)
 * lands on Console automatically; a run with a real result keeps the data view
 * and offers Console alongside.
 */
export function ResultPanel(): JSX.Element {
  const { t } = useTranslation()
  const results = useAppStore((s) => getActiveTab(s).results)
  const active = useAppStore((s) => getActiveResult(s))
  const result = active?.result ?? null
  const view = useAppStore((s) => s.resultView)
  const setView = useAppStore((s) => s.setResultView)
  const docCtx = docActionContext(result, active?.query ?? null)
  // Anchor for the "copy all" format dropdown (null = closed).
  const [copyMenu, setCopyMenu] = useState<{ x: number; y: number } | null>(null)

  const hasOutput = !!result?.output?.length
  // Scripts that only print (REPL completion value null/undefined) open on
  // Console; everything else opens on the data view with Console one click away.
  const autoConsole = hasOutput && result!.kind === 'value' && result!.data == null
  // The user's explicit Console-vs-data choice, per result tab (so switching
  // result tabs restores each one's view). Pruned to live ids on update.
  const [consoleChoice, setConsoleChoice] = useState<Record<string, boolean>>({})
  const showConsole = hasOutput && !!active && (consoleChoice[active.id] ?? autoConsole)
  const chooseConsole = (on: boolean): void => {
    if (!active) return
    setConsoleChoice((prev) => {
      const next: Record<string, boolean> = { [active.id]: on }
      for (const r of results) if (r.id in prev && r.id !== active.id) next[r.id] = prev[r.id]
      return next
    })
  }

  // Cmd/Ctrl+1/2/3 switch Tree/JSON/Table (and ⌘4 Console when present) — only
  // while the switcher is showing (a documents/value result, not error/explain).
  const switchable = !!result && result.kind !== 'error' && result.kind !== 'explain'
  useEffect(() => {
    if (!switchable) return
    const keyMap: Record<string, ResultView> = { '1': 'tree', '2': 'json', '3': 'table' }
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return
      if (e.key === '4') {
        if (!hasOutput) return
        e.preventDefault()
        chooseConsole(true)
        return
      }
      const target = keyMap[e.key]
      if (!target) return
      e.preventDefault()
      chooseConsole(false)
      setView(target)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [switchable, hasOutput, active?.id, setView])

  // One tab per run; the strip only appears once there is something to switch
  // between (a single result reads exactly as before).
  const strip =
    results.length > 1 ? <ResultTabStrip results={results} activeId={active?.id ?? null} /> : null

  if (!result) {
    return (
      <div className="result-panel">
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
      <div className="result-panel">
        {strip}
        <ErrorView result={result} compact={hasOutput} />
        {hasOutput && (
          <div className="result-body">
            <ConsoleView output={result.output!} truncated={result.outputTruncated} />
          </div>
        )}
      </div>
    )
  }

  // Explain has its own dedicated visualizer; the tree/json/table switcher and
  // doc actions don't apply to it.
  if (result.kind === 'explain') {
    return (
      <div className="result-panel">
        {strip}
        <div className="result-bar">
          <span className="explain-tag">{t('result.explainTag')}</span>
          <ResultMeta result={result} docCount={0} />
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

  return (
    <div className="result-panel">
      {strip}
      <div className="result-bar">
        <div className="view-switch">
          {(['tree', 'json', 'table'] as ResultView[]).map((v, i) => {
            const label = v === 'tree' ? t('result.view.tree') : v === 'json' ? 'JSON' : t('result.view.table')
            return (
              <button
                key={v}
                className={!showConsole && view === v ? 'active' : ''}
                data-tip={`${label} (⌘${i + 1})`}
                onClick={() => {
                  chooseConsole(false)
                  setView(v)
                }}
              >
                {label}
              </button>
            )
          })}
          {hasOutput && (
            <button
              className={showConsole ? 'active' : ''}
              data-tip={`Console (⌘4)`}
              onClick={() => chooseConsole(true)}
            >
              {t('result.view.console')}
            </button>
          )}
        </div>
        <ResultMeta result={result} docCount={docs.length} />
        <span className="result-bar-spacer" />
        {result.kind === 'documents' && <PageSizeControl />}
        {result.kind === 'documents' && <ResultPager result={result} />}
        <button
          className="ghost result-copy"
          data-tip={t('result.copyAllTip')}
          aria-label={t('result.copyAllTip')}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            setCopyMenu({ x: r.left, y: r.bottom + 4 })
          }}
        >
          <Copy size={14} />
        </button>
      </div>

      <div className="result-body">
        {showConsole ? (
          <ConsoleView output={result.output!} truncated={result.outputTruncated} />
        ) : (
          <>
            {view === 'tree' && <TreeView docs={docs} docCtx={docCtx} />}
            {view === 'json' && <JsonView docs={docs} />}
            {view === 'table' && <TableView docs={docs} docCtx={docCtx} />}
          </>
        )}
      </div>

      {copyMenu && (
        <ContextMenu
          x={copyMenu.x}
          y={copyMenu.y}
          onClose={() => setCopyMenu(null)}
          items={[
            { label: t('result.copy.pureJson'), onClick: () => void copyText(toPlainJson(docs)) },
            { label: t('result.copy.mongoShell'), onClick: () => void copyText(toShellText(docs)) },
            { label: t('result.copy.extendedJson'), onClick: () => void copyText(toStrictEjson(docs)) },
            { label: t('result.copy.csv'), onClick: () => void copyText(toCsv(docs)) },
            { label: t('result.copy.tsv'), onClick: () => void copyText(toTsv(docs)) }
          ]}
        />
      )}
    </div>
  )
}

/**
 * The result-tab strip: one chip per kept run (newest last), click to focus,
 * ✕ / middle-click to close. New runs always land in a fresh tab (the store
 * caps how many are kept — see lib/tabs MAX_RESULT_TABS).
 */
function ResultTabStrip({
  results,
  activeId
}: {
  results: ResultTab[]
  activeId: string | null
}): JSX.Element {
  const { t } = useTranslation()
  const setActiveResultTab = useAppStore((s) => s.setActiveResultTab)
  const closeResultTab = useAppStore((s) => s.closeResultTab)
  return (
    <div className="result-tabs">
      {results.map((r) => (
        <div
          key={r.id}
          className={r.id === activeId ? 'rtab active' : 'rtab'}
          onClick={() => setActiveResultTab(r.id)}
          onAuxClick={(e) => {
            // Middle-click closes, matching the query-tab convention.
            if (e.button === 1) {
              e.preventDefault()
              closeResultTab(r.id)
            }
          }}
          data-tip={r.query ? firstLine(r.query.code) : undefined}
        >
          <span className="rtab-label">{resultTabLabel(r)}</span>
          <button
            className="rtab-close"
            aria-label={t('result.closeTab')}
            onClick={(e) => {
              e.stopPropagation()
              closeResultTab(r.id)
            }}
          >
            <X size={11} />
          </button>
        </div>
      ))}
    </div>
  )
}

/** Tooltip-sized preview of the query that produced a result tab. */
function firstLine(code: string): string {
  const line = code.split('\n', 1)[0].trim()
  return line.length > 80 ? `${line.slice(0, 80)}…` : line
}

/** Turn any non-error ShellResult into an array of values for the views. */
function normalizeDocs(result: ShellResult): unknown[] {
  if (result.kind === 'documents') {
    return Array.isArray(result.data) ? result.data : []
  }
  // 'value' or 'ack': wrap the single payload (skip undefined).
  return result.data === undefined ? [] : [result.data]
}

function ResultMeta({ result, docCount }: { result: ShellResult; docCount: number }): JSX.Element {
  const { t } = useTranslation()
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
    return out
  }, [result, docCount, t])

  return (
    <div className="result-meta">
      {parts.map((p, i) => (
        <span key={i} className={p.cls}>
          {p.text}
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
function ResultPager({ result }: { result: ShellResult }): JSX.Element | null {
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
      <button
        className="ghost"
        disabled={skip === 0 || running}
        data-tip={t('result.prevPage')}
        aria-label={t('result.prevPage')}
        onClick={() => void loadPage(Math.max(0, skip - limit))}
      >
        <ChevronLeft size={15} />
      </button>
      <span className="result-range">
        {from}–{to}
      </span>
      <button
        className="ghost"
        disabled={!result.truncated || running}
        data-tip={t('result.nextPage')}
        aria-label={t('result.nextPage')}
        onClick={() => void loadPage(skip + limit)}
      >
        <ChevronRight size={15} />
      </button>
    </div>
  )
}

/** Page-size (per-page doc count) control; commits on blur / Enter, then re-runs. */
function PageSizeControl(): JSX.Element {
  const { t } = useTranslation()
  const limit = useAppStore((s) => s.settings.queryLimit)
  const setQueryLimit = useAppStore((s) => s.setQueryLimit)
  const running = useAppStore((s) => getActiveTab(s).running)
  const [val, setVal] = useState(String(limit))
  useEffect(() => setVal(String(limit)), [limit])

  const commit = (): void => {
    const n = Math.min(1000, Math.max(1, parseInt(val, 10) || limit))
    setVal(String(n))
    if (n !== limit) void setQueryLimit(n)
  }
  return (
    <label className="page-size" data-tip={t('result.pageSizeTip')}>
      <span>{t('result.pageSizeLabel')}</span>
      <input
        type="number"
        min={1}
        max={1000}
        value={val}
        disabled={running}
        onChange={(e) => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
      />
    </label>
  )
}

function ErrorView({ result, compact }: { result: ShellResult; compact?: boolean }): JSX.Element {
  const { t } = useTranslation()
  return (
    // Compact mode: a banner above the run's console output instead of the
    // full-height body (the output printed before the failure stays visible).
    <div className={compact ? 'result-error-banner' : 'result-body'}>
      <div className="error-panel">
        <div className="error-name">{result.errorName ?? t('result.errorName')}</div>
        <div className="error-msg">{result.error ?? t('result.errorUnknown')}</div>
      </div>
    </div>
  )
}
