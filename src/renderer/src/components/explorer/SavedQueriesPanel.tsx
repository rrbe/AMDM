/**
 * Saved Queries — the sidebar view formerly known as the "Library" modal.
 * Two sub-tabs:
 *
 *  - Saved: persisted SavedQuery items. Clicking a row loads it into the editor
 *    (applyQuery, never auto-runs); a hover trash button deletes it.
 *  - History: execution history newest-first. Clicking loads; the list can be
 *    cleared.
 *
 * The panel only seeds the editor; running stays an explicit user action
 * (ADR-0004 rule 5). It reads the same store slices the old modal used.
 */
import { useMemo, useState } from 'react'
import { ChevronRight, Trash2 } from 'lucide-react'
import type { HistoryEntry, SavedQuery } from '@shared/types'
import { useAppStore } from '@renderer/store/useAppStore'

type Tab = 'saved' | 'history'

interface SavedQueriesPanelProps {
  /** Whether the drawer is expanded. */
  open: boolean
  /** Toggle the drawer open/closed. */
  onToggle: () => void
}

/** One-line preview of a (possibly multi-line) code snippet. */
function codePreview(code: string): string {
  const firstLine = code.split('\n').find((l) => l.trim().length > 0) ?? code
  const trimmed = firstLine.trim()
  return trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed
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
  return new Date(ts).toLocaleDateString()
}

export function SavedQueriesPanel({ open, onToggle }: SavedQueriesPanelProps): JSX.Element {
  const savedQueries = useAppStore((s) => s.savedQueries)
  const history = useAppStore((s) => s.history)
  const deleteQuery = useAppStore((s) => s.deleteQuery)
  const clearHistory = useAppStore((s) => s.clearHistory)
  const applyQuery = useAppStore((s) => s.applyQuery)

  const [tab, setTab] = useState<Tab>('saved')

  // History is newest-first by ranAt.
  const sortedHistory = useMemo(() => [...history].sort((a, b) => b.ranAt - a.ranAt), [history])

  return (
    <div className="sq-panel">
      <div className="side-section-head sq-head" onClick={onToggle}>
        <span className="sq-twisty">
          <ChevronRight size={14} className={open ? 'twisty-icon open' : 'twisty-icon'} />
        </span>
        <span className="side-section-title">Saved Queries</span>
        {open && (
          <div className="sq-switch" onClick={(e) => e.stopPropagation()}>
            <button className={tab === 'saved' ? 'active' : ''} onClick={() => setTab('saved')}>
              Saved
            </button>
            <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>
              History ({history.length})
            </button>
          </div>
        )}
      </div>

      {open && (
        <div className="sq-body">
          {tab === 'saved' ? (
            <SavedTab
              queries={savedQueries}
              onLoad={applyQuery}
              onDelete={(id) => void deleteQuery(id)}
            />
          ) : (
            <HistoryTab
              entries={sortedHistory}
              onLoad={applyQuery}
              onClear={() => void clearHistory()}
            />
          )}
        </div>
      )}
    </div>
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
    return <div className="sq-empty muted">No saved queries yet. Use “Save” in the toolbar.</div>
  }
  return (
    <div className="sq-list">
      {queries.map((q) => (
        <div
          key={q.id}
          className="sq-row"
          onClick={() => onLoad(q.code, q.database)}
          title={q.code}
        >
          <div className="sq-name">{q.name}</div>
          <code className="sq-code">{codePreview(q.code)}</code>
          <div className="sq-sub muted">{q.database ? `db: ${q.database}` : 'no db'}</div>
          <button
            className="ghost sq-del"
            title="Delete"
            onClick={(e) => {
              e.stopPropagation()
              onDelete(q.id)
            }}
          >
            <Trash2 size={13} />
          </button>
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
    return <div className="sq-empty muted">No history yet.</div>
  }
  return (
    <>
      <div className="sq-toolbar">
        <span className="spacer" />
        <button className="ghost danger" onClick={onClear}>
          Clear
        </button>
      </div>
      <div className="sq-list">
        {entries.map((h) => (
          <div
            key={h.id}
            className="sq-row"
            onClick={() => onLoad(h.code, h.database)}
            title={h.code}
          >
            <code className="sq-code">{codePreview(h.code)}</code>
            <div className="sq-sub muted">
              <span>db: {h.database}</span>
              <span>·</span>
              <span>{formatTime(h.ranAt)}</span>
              <span>·</span>
              <span className={h.ok ? 'lib-ok' : 'lib-err'}>{h.summary ?? (h.ok ? 'ok' : 'error')}</span>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
