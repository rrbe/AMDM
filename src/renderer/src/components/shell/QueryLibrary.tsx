/**
 * Query Library modal — two tabs:
 *
 *  - Saved: persisted SavedQuery items. Each row can be Loaded into the editor
 *    (applyQuery, never auto-runs) or Deleted.
 *  - History: execution history newest-first. Each row can be Loaded; the whole
 *    list can be cleared.
 *
 * The modal only seeds the editor; running stays an explicit user action.
 */
import { useMemo, useState } from 'react'
import type { HistoryEntry, SavedQuery } from '@shared/types'
import { Modal } from '@renderer/components/common/Modal'
import { useAppStore } from '@renderer/store/useAppStore'

interface QueryLibraryProps {
  onClose: () => void
}

type Tab = 'saved' | 'history'

/** One-line preview of a (possibly multi-line) code snippet. */
function codePreview(code: string): string {
  const firstLine = code.split('\n').find((l) => l.trim().length > 0) ?? code
  const trimmed = firstLine.trim()
  return trimmed.length > 90 ? `${trimmed.slice(0, 90)}…` : trimmed
}

/** Relative-ish timestamp, falling back to a locale string. */
function formatTime(ts: number): string {
  const diff = Date.now() - ts
  const sec = Math.round(diff / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  return new Date(ts).toLocaleString()
}

export function QueryLibrary({ onClose }: QueryLibraryProps): JSX.Element {
  const savedQueries = useAppStore((s) => s.savedQueries)
  const history = useAppStore((s) => s.history)
  const deleteQuery = useAppStore((s) => s.deleteQuery)
  const clearHistory = useAppStore((s) => s.clearHistory)
  const applyQuery = useAppStore((s) => s.applyQuery)

  const [tab, setTab] = useState<Tab>('saved')

  // History is newest-first by ranAt.
  const sortedHistory = useMemo(() => [...history].sort((a, b) => b.ranAt - a.ranAt), [history])

  const load = (code: string, database?: string): void => {
    applyQuery(code, database)
    onClose()
  }

  return (
    <Modal title="Query Library" onClose={onClose}>
      <div className="tabs">
        <button className={tab === 'saved' ? 'active' : ''} onClick={() => setTab('saved')}>
          Saved ({savedQueries.length})
        </button>
        <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>
          History ({history.length})
        </button>
      </div>

      {tab === 'saved' ? (
        <SavedTab queries={savedQueries} onLoad={load} onDelete={(id) => void deleteQuery(id)} />
      ) : (
        <HistoryTab
          entries={sortedHistory}
          onLoad={load}
          onClear={() => void clearHistory()}
        />
      )}
    </Modal>
  )
}

function SavedTab({
  queries,
  onLoad,
  onDelete
}: {
  queries: SavedQuery[]
  onLoad: (code: string, database?: string) => void
  onDelete: (id: string) => void
}): JSX.Element {
  if (queries.length === 0) {
    return <div className="lib-empty muted">No saved queries yet. Use “Save” in the toolbar.</div>
  }
  return (
    <div className="lib-list">
      {queries.map((q) => (
        <div key={q.id} className="lib-row">
          <div className="lib-main">
            <div className="lib-name">{q.name}</div>
            <code className="lib-code">{codePreview(q.code)}</code>
            <div className="lib-sub muted">{q.database ? `db: ${q.database}` : 'no db'}</div>
          </div>
          <div className="lib-actions">
            <button onClick={() => onLoad(q.code, q.database)}>Load</button>
            <button className="danger" onClick={() => onDelete(q.id)}>
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

function HistoryTab({
  entries,
  onLoad,
  onClear
}: {
  entries: HistoryEntry[]
  onLoad: (code: string, database?: string) => void
  onClear: () => void
}): JSX.Element {
  if (entries.length === 0) {
    return <div className="lib-empty muted">No history yet.</div>
  }
  return (
    <>
      <div className="lib-toolbar">
        <span className="spacer" />
        <button className="danger" onClick={onClear}>
          Clear history
        </button>
      </div>
      <div className="lib-list">
        {entries.map((h) => (
          <div key={h.id} className="lib-row">
            <div className="lib-main">
              <code className="lib-code">{codePreview(h.code)}</code>
              <div className="lib-sub muted">
                <span>db: {h.database}</span>
                <span>·</span>
                <span>{formatTime(h.ranAt)}</span>
                <span>·</span>
                <span className={h.ok ? 'lib-ok' : 'lib-err'}>{h.summary ?? (h.ok ? 'ok' : 'error')}</span>
              </div>
            </div>
            <div className="lib-actions">
              <button onClick={() => onLoad(h.code, h.database)}>Load</button>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
