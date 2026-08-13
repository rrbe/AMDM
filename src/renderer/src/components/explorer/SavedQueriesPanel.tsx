/** Saved Queries and History views embedded in the left panel. Both only seed
 * the Shell; running remains an explicit user action. */
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Trash2 } from 'lucide-react'
import type { HistoryEntry, SavedQuery } from '@shared/types'
import { useAppStore } from '@renderer/store/useAppStore'
import { Button } from '@renderer/components/common/Button'
import { ContextMenu, type ContextMenuEntry } from '@renderer/components/ContextMenu'

/** Group saved queries by folder; folders alpha, ungrouped (`''`) last. */
function groupByFolder(queries: SavedQuery[]): { folder: string; items: SavedQuery[] }[] {
  const map = new Map<string, SavedQuery[]>()
  for (const q of queries) {
    const key = q.folder ?? ''
    const arr = map.get(key)
    if (arr) arr.push(q)
    else map.set(key, [q])
  }
  const keys = [...map.keys()].sort((a, b) => {
    if (a === '') return 1
    if (b === '') return -1
    return a.localeCompare(b)
  })
  return keys.map((folder) => ({ folder, items: map.get(folder) ?? [] }))
}

export interface StoredQuerySelection {
  code: string
  connectionId?: string
  connectionName?: string
  database?: string
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

export function SavedQueriesView({
  onLoad
}: {
  onLoad: (query: StoredQuerySelection) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const savedQueries = useAppStore((s) => s.savedQueries)
  const connections = useAppStore((s) => s.connections)
  const deleteQuery = useAppStore((s) => s.deleteQuery)
  const saveQuery = useAppStore((s) => s.saveQuery)

  const moveToFolder = (q: SavedQuery, folder: string | undefined): void => {
    void saveQuery({
      id: q.id,
      name: q.name,
      code: q.code,
      connectionId: q.connectionId,
      database: q.database,
      folder
    })
  }

  return (
    <section className="library-view">
      <div className="library-head">
        <h1>{t('savedQueries.title')}</h1>
        <span className="library-count">· {savedQueries.length}</span>
      </div>
      <div className="library-body">
        <SavedTab
          queries={savedQueries}
          onLoad={(query) =>
            onLoad({
              code: query.code,
              connectionId: query.connectionId,
              connectionName:
                connections.find((item) => item.id === query.connectionId)?.name ??
                query.connectionId,
              database: query.database
            })
          }
          onDelete={(id) => void deleteQuery(id)}
          onMove={moveToFolder}
        />
      </div>
    </section>
  )
}

export function HistoryView({
  onLoad
}: {
  onLoad: (query: StoredQuerySelection) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const history = useAppStore((s) => s.history)
  const connections = useAppStore((s) => s.connections)
  const clearHistory = useAppStore((s) => s.clearHistory)

  const sortedHistory = useMemo(() => [...history].sort((a, b) => b.ranAt - a.ranAt), [history])

  return (
    <section className="library-view">
      <div className="library-head">
        <h1>{t('savedQueries.tabHistory')}</h1>
        <span className="library-count">· {history.length}</span>
        {history.length > 0 && (
          <Button
            className="ml-auto"
            variant="danger"
            size="sm"
            onClick={() => void clearHistory()}
          >
            {t('savedQueries.clearHistory')}
          </Button>
        )}
      </div>
      <div className="library-body">
        <HistoryTab
          entries={sortedHistory}
          onLoad={(entry) =>
            onLoad({
              code: entry.code,
              connectionId: entry.connectionId,
              connectionName:
                connections.find((item) => item.id === entry.connectionId)?.name ??
                entry.connectionId,
              database: entry.database
            })
          }
        />
      </div>
    </section>
  )
}

function SavedTab({
  queries,
  onLoad,
  onDelete,
  onMove
}: {
  queries: SavedQuery[]
  onLoad: (query: SavedQuery) => void
  onDelete: (id: string) => void
  onMove: (q: SavedQuery, folder: string | undefined) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  // Collapsed folder names (default: all expanded).
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  // Right-click action menu, anchored to a specific query.
  const [menu, setMenu] = useState<{
    x: number
    y: number
    q: SavedQuery
  } | null>(null)

  const groups = useMemo(() => groupByFolder(queries), [queries])
  // All real (non-empty) folder names — drives both "group or flat" and the
  // move-to targets in the context menu.
  const folderNames = useMemo(() => groups.map((g) => g.folder).filter((f) => f !== ''), [groups])

  if (queries.length === 0) {
    return <div className="sq-empty muted">{t('savedQueries.emptySaved')}</div>
  }

  const toggle = (folder: string): void =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(folder)) next.delete(folder)
      else next.add(folder)
      return next
    })

  const buildMenu = (q: SavedQuery): ContextMenuEntry[] => {
    const targets = folderNames.filter((f) => f !== (q.folder ?? ''))
    const items: ContextMenuEntry[] = [
      { label: t('savedQueries.menuLoad'), onClick: () => onLoad(q) }
    ]
    if (targets.length > 0 || q.folder) items.push('separator')
    for (const f of targets)
      items.push({
        label: t('savedQueries.menuMoveTo', { folder: f }),
        onClick: () => onMove(q, f)
      })
    if (q.folder)
      items.push({
        label: t('savedQueries.menuMoveOut'),
        onClick: () => onMove(q, undefined)
      })
    items.push('separator', {
      label: t('savedQueries.menuDelete'),
      danger: true,
      onClick: () => onDelete(q.id)
    })
    return items
  }

  const renderRow = (q: SavedQuery): React.JSX.Element => (
    <div
      key={q.id}
      className="sq-row"
      onClick={() => onLoad(q)}
      onContextMenu={(e) => {
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY, q })
      }}
      data-tip={q.code}
    >
      <div className="sq-name">{q.name}</div>
      <code className="sq-code">{codePreview(q.code)}</code>
      <div className="sq-sub muted">
        {q.database ? `db: ${q.database}` : t('savedQueries.noDb')}
      </div>
      <button
        className="ghost sq-del"
        data-tip={t('savedQueries.menuDelete')}
        aria-label={t('savedQueries.menuDelete')}
        onClick={(e) => {
          e.stopPropagation()
          onDelete(q.id)
        }}
      >
        <Trash2 size={13} />
      </button>
    </div>
  )

  // No real folders yet → flat list (no group chrome), matching the old look.
  const flat = folderNames.length === 0

  return (
    <div className="sq-list">
      {flat
        ? queries.map(renderRow)
        : groups.map(({ folder, items }) => {
            const label = folder === '' ? t('savedQueries.ungrouped') : folder
            const isCollapsed = collapsed.has(folder)
            return (
              <div key={folder || ' ungrouped'} className="sq-folder">
                <div className="sq-folder-head" onClick={() => toggle(folder)}>
                  <ChevronRight
                    size={13}
                    className={isCollapsed ? 'twisty-icon' : 'twisty-icon open'}
                  />
                  <span className="sq-folder-name">{label}</span>
                  <span className="sq-folder-count muted">{items.length}</span>
                </div>
                {!isCollapsed && items.map(renderRow)}
              </div>
            )
          })}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={buildMenu(menu.q)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}

function HistoryTab({
  entries,
  onLoad
}: {
  entries: HistoryEntry[]
  onLoad: (entry: HistoryEntry) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  if (entries.length === 0) {
    return <div className="sq-empty muted">{t('savedQueries.emptyHistory')}</div>
  }
  return (
    <div className="sq-list">
      {entries.map((h) => (
        <div key={h.id} className="sq-row" onClick={() => onLoad(h)} data-tip={h.code}>
          <code className="sq-code">{codePreview(h.code)}</code>
          <div className="sq-sub muted">
            <span>db: {h.database}</span>
            <span>·</span>
            <span>{formatTime(h.ranAt)}</span>
            <span>·</span>
            <span className={h.ok ? 'lib-ok' : 'lib-err'}>
              {h.summary ?? (h.ok ? 'ok' : 'error')}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}
