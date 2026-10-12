import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Bookmark, Clock3, FileCode2, LoaderCircle, Search, Table2, Plug } from 'lucide-react'
import { useAppStore } from '@renderer/store/useAppStore'
import { TreeIcon } from '@renderer/components/explorer/Explorer'
import { Dialog, DialogTitle } from '@renderer/components/ui/Dialog'
import { Input } from '@renderer/components/ui/Input'
import { Select } from '@renderer/components/ui/Select'
import { Button } from '@renderer/components/common/Button'
import { isAppShortcutEnabled, isMacPlatform, isPrimaryShortcut } from '@renderer/lib/keyboardShortcuts'
import {
  catalogSearchDocuments,
  storedSearchDocuments,
  tabSearchDocuments,
  type CatalogDestination
} from '@renderer/lib/quickSearch/documents'
import { QuickSearchClient } from '@renderer/lib/quickSearch/client'
import {
  SEARCH_GROUPS,
  type SearchGroup,
  type SearchHit,
  type SearchRank,
  type SearchResult,
  type SearchScope
} from '@renderer/lib/quickSearch/types'
import { useSearchVisits } from '@renderer/lib/quickSearch/visits'
import styles from './QuickSearch.module.css'

const icons = { connections: Plug, queries: FileCode2, data: Table2, saved: Bookmark, history: Clock3 }
type Row =
  | { kind: 'heading'; group: SearchGroup; total: number }
  | { kind: 'hit'; hit: SearchHit }
  | { kind: 'more'; group: SearchGroup }

function Match({ text, query }: { text: string; query: string }): React.JSX.Element {
  const at = query ? text.toLocaleLowerCase().indexOf(query.trim().toLocaleLowerCase()) : -1
  if (at < 0 || !query.trim()) return <>{text}</>
  return (
    <>
      {text.slice(0, at)}
      <mark className="search-match">{text.slice(at, at + query.trim().length)}</mark>
      {text.slice(at + query.trim().length)}
    </>
  )
}

export function QuickSearch({
  initialScope,
  onClose,
  onSelect
}: {
  initialScope: SearchScope
  onClose: () => void
  onSelect: (hit: SearchHit, destination?: CatalogDestination) => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const connections = useAppStore((s) => s.connections)
  const statuses = useAppStore((s) => s.statuses)
  const catalogs = useAppStore((s) => s.catalogs)
  const sort = useAppStore((s) => s.settings.collectionSort)
  const tabs = useAppStore((s) => s.tabs)
  const saved = useAppStore((s) => s.savedQueries)
  const history = useAppStore((s) => s.history)
  const connectionId = useAppStore((s) => s.activeConnectionId)
  const shortcutEnabled = useAppStore((s) =>
    isAppShortcutEnabled(
      s.settings.keyboardShortcutsEnabled,
      s.settings.disabledKeyboardShortcuts,
      'quickSearch'
    )
  )
  const visits = useSearchVisits()
  const [scope, setScope] = useState(initialScope)
  const [query, setQuery] = useState('')
  const [term, setTerm] = useState('')
  const [cursors, setCursors] = useState<SearchRank[]>([])
  const [result, setResult] = useState<SearchResult | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string>()
  const [selected, setSelected] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const scroll = useRef<HTMLDivElement>(null)
  const client = useRef<QuickSearchClient | null>(null)
  const titleId = useId()
  const listId = useId()
  const previousFocus = useRef(document.activeElement as HTMLElement | null)
  const catalog = useMemo(
    () => catalogSearchDocuments(connections, statuses, catalogs, sort),
    [connections, statuses, catalogs, sort]
  )
  const tabDocuments = useMemo(
    () => tabSearchDocuments(tabs, connections),
    [tabs, connections, i18n.language]
  )
  const storedDocuments = useMemo(
    () => storedSearchDocuments(saved, history, connections),
    [saved, history, connections, i18n.language]
  )
  const documents = useMemo(
    () => [...catalog.documents, ...tabDocuments, ...storedDocuments],
    [catalog, tabDocuments, storedDocuments]
  )

  useEffect(() => {
    client.current = new QuickSearchClient((next, failure) => {
      setResult(next)
      setError(failure)
      setBusy(false)
    })
    input.current?.focus({ preventScroll: true })
    return () => {
      client.current?.dispose()
      client.current = null
    }
  }, [])
  useEffect(() => {
    client.current?.sync(documents)
    setCursors([])
  }, [documents])
  useEffect(() => {
    setBusy(true)
    setError(undefined)
    client.current?.search({ query: term, scope, connectionId, visits, after: cursors.at(-1) })
    return () => client.current?.cancel()
  }, [term, scope, connectionId, visits, documents, cursors])

  const rows = useMemo<Row[]>(() => {
    if (!result) return []
    return SEARCH_GROUPS.flatMap((group) => {
      const hits = result.hits.filter((hit) => hit.group === group)
      if (!hits.length) return []
      const rows: Row[] = [
        { kind: 'heading', group, total: result.totals[group] },
        ...hits.map((hit): Row => ({ kind: 'hit', hit }))
      ]
      if (scope === 'all' && result.totals[group] > hits.length) rows.push({ kind: 'more', group })
      return rows
    })
  }, [result, scope])
  const rowKey = (row: Row): string => (row.kind === 'hit' ? row.hit.id : `${row.kind}:${row.group}`)
  const options = rows.filter((row) => row.kind !== 'heading')
  const activeKey = options.some((row) => rowKey(row) === selected)
    ? selected
    : options[0]
      ? rowKey(options[0])
      : null
  const activeIndex = rows.findIndex((row) => rowKey(row) === activeKey)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroll.current,
    initialRect: { width: 660, height: 440 },
    estimateSize: (index) => (rows[index].kind === 'hit' ? 76 : 32),
    getItemKey: (index) => rowKey(rows[index]),
    overscan: 4
  })
  useEffect(() => {
    if (busy) return
    if (!options.some((row) => rowKey(row) === selected)) setSelected(options[0] ? rowKey(options[0]) : null)
  }, [result, busy])
  useEffect(() => {
    if (activeIndex >= 0) virtualizer.scrollToIndex(activeIndex, { align: 'auto' })
  }, [activeIndex])

  const changeScope = (next: SearchScope): void => {
    setScope(next)
    setCursors([])
    setSelected(null)
    setResult(null)
    input.current?.focus({ preventScroll: true })
  }
  const activate = (row: Row): void => {
    if (busy) return
    if (row.kind === 'more') changeScope(row.group)
    else if (row.kind === 'hit') onSelect(row.hit, catalog.destinations.get(row.hit.id))
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      className={styles.dialog}
      aria-labelledby={titleId}
      initialFocus={() => input.current ?? true}
      finalFocus={() =>
        previousFocus.current?.isConnected
          ? previousFocus.current
          : (document.querySelector<HTMLElement>('.cm-content[contenteditable=true]') ?? true)
      }
    >
      <div
        className={styles.content}
        data-quick-search
        data-search-engine={client.current?.mode}
        onKeyDownCapture={(event) => {
          if (event.nativeEvent.isComposing) return
          if (shortcutEnabled && isPrimaryShortcut(event.nativeEvent, 'k', isMacPlatform())) {
            event.preventDefault()
            event.stopPropagation()
            if (!event.repeat) onClose()
          }
        }}
      >
        <DialogTitle id={titleId} className="sr-only">
          {t('quickSearch.title')}
        </DialogTitle>
        <div className={styles.searchBar}>
          <Search size={19} aria-hidden />
          <Input
            ref={input}
            className={styles.input}
            value={query}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
            aria-autocomplete="list"
            aria-label={t('quickSearch.title')}
            placeholder={t('quickSearch.placeholder')}
            onCompositionEnd={(event) => {
              setTerm(event.currentTarget.value)
              setCursors([])
              setSelected(null)
            }}
            onChange={(event) => {
              setQuery(event.target.value)
              if (!(event.nativeEvent as InputEvent).isComposing) {
                setTerm(event.target.value)
                setCursors([])
                setSelected(null)
              }
            }}
            onKeyDown={(event) => {
              if (
                event.nativeEvent.isComposing ||
                event.altKey ||
                event.ctrlKey ||
                event.metaKey ||
                event.shiftKey
              )
                return
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                if (busy || !options.length) return
                const current = options.findIndex((row) => rowKey(row) === activeKey)
                const next =
                  (current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
                setSelected(rowKey(options[next]))
              } else if (event.key === 'Enter') {
                event.preventDefault()
                const row = rows[activeIndex]
                if (row) activate(row)
              }
            }}
          />
          <Select<SearchScope>
            value={scope}
            onChange={changeScope}
            finalFocus={() => input.current ?? true}
            className={styles.filter}
            aria-label={t('quickSearch.filter')}
            options={['all' as const, ...SEARCH_GROUPS].map((value) => ({
              value,
              label: t(`quickSearch.groups.${value}`)
            }))}
          />
        </div>
        <div className={styles.status} aria-live="polite">
          <span>
            {!term.trim() && scope === 'all' ? t('quickSearch.recent') : t('quickSearch.loadedOnly')}
          </span>
          {busy && (
            <LoaderCircle size={14} className="animate-spin" aria-label={t('quickSearch.searching')} />
          )}
        </div>
        <div
          ref={scroll}
          id={listId}
          role="listbox"
          aria-label={t('quickSearch.results')}
          aria-busy={busy}
          data-search-query={result?.query}
          data-search-scope={result?.scope}
          className={styles.list}
        >
          {(!result || !rows.length) && (
            <div className={styles.empty} role="status">
              {error ??
                (busy
                  ? t('quickSearch.searching')
                  : t(!term.trim() && scope === 'all' ? 'quickSearch.noRecent' : 'quickSearch.noResults'))}
            </div>
          )}
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index]
              const Icon = row.kind === 'hit' ? icons[row.hit.group] : null
              return (
                <div
                  key={item.key}
                  ref={virtualizer.measureElement}
                  data-index={item.index}
                  id={`${listId}-${item.index}`}
                  role={row.kind === 'heading' ? 'presentation' : 'option'}
                  aria-selected={row.kind !== 'heading' ? rowKey(row) === activeKey : undefined}
                  aria-disabled={row.kind !== 'heading' ? busy : undefined}
                  data-search-id={row.kind === 'hit' ? row.hit.id : undefined}
                  className={
                    row.kind === 'heading' ? styles.heading : row.kind === 'more' ? styles.more : styles.hit
                  }
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${item.start}px)`
                  }}
                  onPointerMove={
                    row.kind === 'heading'
                      ? undefined
                      : () => {
                          if (!busy) setSelected(rowKey(row))
                        }
                  }
                  onPointerDown={row.kind === 'heading' ? undefined : (event) => event.preventDefault()}
                  onClick={() => activate(row)}
                >
                  {row.kind === 'heading' ? (
                    <>
                      {t(`quickSearch.groups.${row.group}`)}
                      <span>{row.total}</span>
                    </>
                  ) : row.kind === 'more' ? (
                    t('quickSearch.viewAll')
                  ) : (
                    <>
                      <span className={styles.icon}>
                        {row.hit.icon ? (
                          <TreeIcon name={row.hit.icon} />
                        ) : (
                          Icon && <Icon size={18} aria-hidden />
                        )}
                      </span>
                      <div className={styles.text}>
                        <div className={styles.label}>
                          <Match text={row.hit.label} query={term} />
                          {row.hit.approximate && <small>≈</small>}
                          {row.hit.count && row.hit.count > 1 && (
                            <small>{t('quickSearch.executions', { count: row.hit.count })}</small>
                          )}
                        </div>
                        <div className={styles.detail}>
                          <Match text={row.hit.detail} query={term} />
                        </div>
                        {row.hit.preview && (
                          <code className={styles.preview}>
                            <Match text={row.hit.preview} query={term} />
                          </code>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>
        <div className={styles.footer}>
          <span>{t('quickSearch.keyboardHint')}</span>
          {scope !== 'all' && (
            <div className={styles.pagination}>
              <Button
                disabled={busy || !cursors.length}
                onClick={() => {
                  setCursors((value) => value.slice(0, -1))
                  scroll.current?.scrollTo(0, 0)
                }}
              >
                {t('quickSearch.previous')}
              </Button>
              <span>{cursors.length + 1}</span>
              <Button
                disabled={busy || !result?.more}
                onClick={() => {
                  const last = result?.hits.at(-1)
                  if (last) {
                    setCursors((value) => [...value, last.rank])
                    scroll.current?.scrollTo(0, 0)
                    setSelected(null)
                  }
                }}
              >
                {t('quickSearch.next')}
              </Button>
            </div>
          )}
        </div>
      </div>
    </Dialog>
  )
}
