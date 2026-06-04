import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Copy } from 'lucide-react'
import type { ShellResult } from '@shared/types'
import { useAppStore, getActiveTab, type ResultView } from '@renderer/store/useAppStore'
import { docActionContext } from '@renderer/lib/docActions'
import { copyText, toCsv, toPlainJson, toShellText, toStrictEjson, toTsv } from '@renderer/lib/resultCopy'
import { ContextMenu } from '@renderer/components/ContextMenu'
import { TreeView } from './TreeView'
import { JsonView } from './JsonView'
import { TableView } from './TableView'
import { ExplainView } from './ExplainView'

/**
 * View switcher (Tree | JSON | Table) + metadata bar. Handles every
 * ShellResult.kind: 'documents' (array), 'value', 'ack', 'error'.
 */
export function ResultPanel(): JSX.Element {
  const result = useAppStore((s) => getActiveTab(s).result)
  const view = useAppStore((s) => s.resultView)
  const setView = useAppStore((s) => s.setResultView)
  const lastQuery = useAppStore((s) => getActiveTab(s).lastQuery)
  const docCtx = docActionContext(result, lastQuery)
  // Anchor for the "copy all" format dropdown (null = closed).
  const [copyMenu, setCopyMenu] = useState<{ x: number; y: number } | null>(null)

  // Cmd/Ctrl+1/2/3 switch Tree/JSON/Table — only while the switcher is showing
  // (a documents/value result, not error/explain/empty).
  const switchable = !!result && result.kind !== 'error' && result.kind !== 'explain'
  useEffect(() => {
    if (!switchable) return
    const keyMap: Record<string, ResultView> = { '1': 'tree', '2': 'json', '3': 'table' }
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return
      const target = keyMap[e.key]
      if (!target) return
      e.preventDefault()
      setView(target)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [switchable, setView])

  if (!result) {
    return (
      <div className="result-panel">
        <div className="result-body">
          <div className="center-msg muted">Run a query to see results.</div>
        </div>
      </div>
    )
  }

  if (result.kind === 'error') {
    return (
      <div className="result-panel">
        <ErrorView result={result} />
      </div>
    )
  }

  // Explain has its own dedicated visualizer; the tree/json/table switcher and
  // doc actions don't apply to it.
  if (result.kind === 'explain') {
    return (
      <div className="result-panel">
        <div className="result-bar">
          <span className="explain-tag">EXPLAIN</span>
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
      <div className="result-bar">
        <div className="view-switch">
          {(['tree', 'json', 'table'] as ResultView[]).map((v, i) => {
            const label = v === 'tree' ? 'Tree' : v === 'json' ? 'JSON' : 'Table'
            return (
              <button
                key={v}
                className={view === v ? 'active' : ''}
                data-tip={`${label} (⌘${i + 1})`}
                onClick={() => setView(v)}
              >
                {label}
              </button>
            )
          })}
        </div>
        <ResultMeta result={result} docCount={docs.length} />
        <span className="result-bar-spacer" />
        {result.kind === 'documents' && <PageSizeControl />}
        {result.kind === 'documents' && <ResultPager result={result} />}
        <button
          className="ghost result-copy"
          data-tip="复制全部结果"
          aria-label="复制全部结果"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            setCopyMenu({ x: r.left, y: r.bottom + 4 })
          }}
        >
          <Copy size={14} />
        </button>
      </div>

      <div className="result-body">
        {view === 'tree' && <TreeView docs={docs} docCtx={docCtx} />}
        {view === 'json' && <JsonView docs={docs} />}
        {view === 'table' && <TableView docs={docs} docCtx={docCtx} />}
      </div>

      {copyMenu && (
        <ContextMenu
          x={copyMenu.x}
          y={copyMenu.y}
          onClose={() => setCopyMenu(null)}
          items={[
            { label: '复制全部 (Pure JSON)', onClick: () => void copyText(toPlainJson(docs)) },
            { label: '复制全部 (MongoShell JS)', onClick: () => void copyText(toShellText(docs)) },
            { label: '复制全部 (Extended JSON)', onClick: () => void copyText(toStrictEjson(docs)) },
            { label: '复制全部为 CSV', onClick: () => void copyText(toCsv(docs)) },
            { label: '复制全部为 TSV', onClick: () => void copyText(toTsv(docs)) }
          ]}
        />
      )}
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

function ResultMeta({ result, docCount }: { result: ShellResult; docCount: number }): JSX.Element {
  const parts = useMemo(() => {
    const out: { text: string; cls?: string }[] = []
    if (result.kind === 'documents') {
      out.push({ text: `${result.count ?? docCount} doc${(result.count ?? docCount) === 1 ? '' : 's'}` })
      // For pageable results the pager shows the range + a next button, so the
      // "truncated" badge would be redundant. Keep it for non-pageable cursors
      // (aggregate / scripts), where raising the page size is the only way on.
      if (result.truncated && !result.pageable) {
        out.push({ text: 'truncated — raise page size to see more', cls: 'truncated' })
      }
    } else if (result.kind === 'value') {
      out.push({ text: 'value' })
    } else if (result.kind === 'ack') {
      out.push({ text: 'write result' })
    }
    if (typeof result.elapsedMs === 'number') {
      out.push({ text: `${result.elapsedMs} ms` })
    }
    return out
  }, [result, docCount])

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
  const skip = useAppStore((s) => getActiveTab(s).resultSkip)
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
        data-tip="上一页"
        aria-label="上一页"
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
        data-tip="下一页"
        aria-label="下一页"
        onClick={() => void loadPage(skip + limit)}
      >
        <ChevronRight size={15} />
      </button>
    </div>
  )
}

/** Page-size (per-page doc count) control; commits on blur / Enter, then re-runs. */
function PageSizeControl(): JSX.Element {
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
    <label className="page-size" data-tip="每页条数（回车应用）">
      <span>每页</span>
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

function ErrorView({ result }: { result: ShellResult }): JSX.Element {
  return (
    <div className="result-body">
      <div className="error-panel">
        <div className="error-name">{result.errorName ?? 'Error'}</div>
        <div className="error-msg">{result.error ?? 'An unknown error occurred.'}</div>
      </div>
    </div>
  )
}
