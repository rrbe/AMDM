/**
 * Two independent sidebar drawers, each its own collapsible section:
 *
 *  - SavedQueriesPanel — persisted SavedQuery items, grouped by folder. Clicking
 *    a row loads it into the editor (applyQuery, never auto-runs); a hover trash
 *    button deletes it.
 *  - HistoryPanel — execution history newest-first. Clicking loads; the list can
 *    be cleared. The head shows the live entry count.
 *
 * Both only seed the editor; running stays an explicit user action (ADR-0004
 * rule 5). They read the same store slices the old combined panel used; the
 * code-preview / time helpers below are shared.
 */
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

interface DrawerProps {
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

/** Saved Queries drawer: a collapsible head over the folder-grouped list. */
export function SavedQueriesPanel({ open, onToggle }: DrawerProps): JSX.Element {
  const { t } = useTranslation()
  const savedQueries = useAppStore((s) => s.savedQueries)
  const deleteQuery = useAppStore((s) => s.deleteQuery)
  const saveQuery = useAppStore((s) => s.saveQuery)
  const applyQuery = useAppStore((s) => s.applyQuery)

  // Re-folder an existing query in place (saveQuery with its id updates it).
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
    <div className="sq-panel">
      <div className="side-section-head sq-head" onClick={onToggle}>
        <span className="sq-twisty">
          <ChevronRight size={14} className={open ? 'twisty-icon open' : 'twisty-icon'} />
        </span>
        <span className="side-section-title">{t('savedQueries.title')}</span>
      </div>

      {open && (
        <div className="sq-body">
          <SavedTab
            queries={savedQueries}
            onLoad={applyQuery}
            onDelete={(id) => void deleteQuery(id)}
            onMove={moveToFolder}
          />
        </div>
      )}
    </div>
  )
}

/** History drawer: a collapsible head (with live count) over the run list. */
export function HistoryPanel({ open, onToggle }: DrawerProps): JSX.Element {
  const { t } = useTranslation()
  const history = useAppStore((s) => s.history)
  const clearHistory = useAppStore((s) => s.clearHistory)
  const applyQuery = useAppStore((s) => s.applyQuery)

  // History is newest-first by ranAt.
  const sortedHistory = useMemo(() => [...history].sort((a, b) => b.ranAt - a.ranAt), [history])

  return (
    <div className="sq-panel">
      <div className="side-section-head sq-head" onClick={onToggle}>
        <span className="sq-twisty">
          <ChevronRight size={14} className={open ? 'twisty-icon open' : 'twisty-icon'} />
        </span>
        <span className="side-section-title">{t('savedQueries.tabHistory')}</span>
        {history.length > 0 && <span className="sq-head-count muted">{history.length}</span>}
      </div>

      {open && (
        <div className="sq-body">
          <HistoryTab
            entries={sortedHistory}
            onLoad={applyQuery}
            onClear={() => void clearHistory()}
          />
        </div>
      )}
    </div>
  )
}

function SavedTab({
  queries,
  onLoad,
  onDelete,
  onMove
}: {
  queries: SavedQuery[]
  onLoad: (code: string, database?: string) => void
  onDelete: (id: string) => void
  onMove: (q: SavedQuery, folder: string | undefined) => void
}): JSX.Element {
  const { t } = useTranslation()
  // Collapsed folder names (default: all expanded).
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  // Right-click action menu, anchored to a specific query.
  const [menu, setMenu] = useState<{ x: number; y: number; q: SavedQuery } | null>(null)

  const groups = useMemo(() => groupByFolder(queries), [queries])
  // All real (non-empty) folder names — drives both "group or flat" and the
  // move-to targets in the context menu.
  const folderNames = useMemo(
    () => groups.map((g) => g.folder).filter((f) => f !== ''),
    [groups]
  )

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
      { label: t('savedQueries.menuLoad'), onClick: () => onLoad(q.code, q.database) }
    ]
    if (targets.length > 0 || q.folder) items.push('separator')
    for (const f of targets) items.push({ label: t('savedQueries.menuMoveTo', { folder: f }), onClick: () => onMove(q, f) })
    if (q.folder) items.push({ label: t('savedQueries.menuMoveOut'), onClick: () => onMove(q, undefined) })
    items.push('separator', {
      label: t('savedQueries.menuDelete'),
      danger: true,
      onClick: () => onDelete(q.id)
    })
    return items
  }

  const renderRow = (q: SavedQuery): JSX.Element => (
    <div
      key={q.id}
      className="sq-row"
      onClick={() => onLoad(q.code, q.database)}
      onContextMenu={(e) => {
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY, q })
      }}
      data-tip={q.code}
    >
      <div className="sq-name">{q.name}</div>
      <code className="sq-code">{codePreview(q.code)}</code>
      <div className="sq-sub muted">{q.database ? `db: ${q.database}` : t('savedQueries.noDb')}</div>
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
  onLoad,
  onClear
}: {
  entries: HistoryEntry[]
  onLoad: (code: string, database?: string) => void
  onClear: () => void
}): JSX.Element {
  const { t } = useTranslation()
  if (entries.length === 0) {
    return <div className="sq-empty muted">{t('savedQueries.emptyHistory')}</div>
  }
  return (
    <>
      <div className="sq-toolbar">
        <span className="spacer" />
        <Button variant="danger" onClick={onClear}>
          {t('savedQueries.clearHistory')}
        </Button>
      </div>
      <div className="sq-list">
        {entries.map((h) => (
          <div
            key={h.id}
            className="sq-row"
            onClick={() => onLoad(h.code, h.database)}
            data-tip={h.code}
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
