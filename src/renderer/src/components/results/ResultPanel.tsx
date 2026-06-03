import { useEffect, useMemo, useState } from 'react'
import { Copy } from 'lucide-react'
import type { ShellResult } from '@shared/types'
import { useAppStore, type ResultView } from '@renderer/store/useAppStore'
import { docActionContext } from '@renderer/lib/docActions'
import { copyText, toPlainJson, toShellText, toStrictEjson } from '@renderer/lib/resultCopy'
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
  const result = useAppStore((s) => s.result)
  const view = useAppStore((s) => s.resultView)
  const setView = useAppStore((s) => s.setResultView)
  const lastQuery = useAppStore((s) => s.lastQuery)
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
                title={`${label} (⌘${i + 1})`}
                onClick={() => setView(v)}
              >
                {label}
              </button>
            )
          })}
        </div>
        <ResultMeta result={result} docCount={docs.length} />
        <span className="result-bar-spacer" />
        <button
          className="ghost result-copy"
          title="复制全部结果"
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
            {
              label: '复制全部 (Plain JSON)',
              onClick: () => void copyText(toPlainJson(docs), `已复制全部 ${docs.length} 文档`)
            },
            { label: '复制全部 (Shell 风格)', onClick: () => void copyText(toShellText(docs)) },
            { label: '复制全部 (严格 EJSON)', onClick: () => void copyText(toStrictEjson(docs)) }
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
      if (result.truncated) {
        out.push({
          text: `truncated — showing first ${result.count ?? docCount}`,
          cls: 'truncated'
        })
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
