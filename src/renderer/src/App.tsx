import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { PanelLeftOpen } from 'lucide-react'
import { getActiveTab, useAppStore } from '@renderer/store/useAppStore'
import { setLanguage } from '@renderer/i18n'
import { Explorer, type ExplorerView } from '@renderer/components/explorer/Explorer'
import type { StoredQuerySelection } from '@renderer/components/explorer/SavedQueriesPanel'
import { ShellWorkspace } from '@renderer/components/shell/ShellWorkspace'
import { QuickSearch } from '@renderer/components/QuickSearch'
import { Toaster } from '@renderer/components/common/Toaster'
import { TooltipLayer } from '@renderer/components/ui/Tooltip'
import { Collapsible } from '@renderer/components/ui/Collapsible'
import { ResizeHandle } from '@renderer/components/common/ResizeHandle'
import { Modal } from '@renderer/components/common/Modal'
import { Button } from '@renderer/components/common/Button'
import { useShortcutHints } from '@renderer/lib/useShortcutHints'
import { useIsDark } from '@renderer/lib/useIsDark'
import {
  hasOpenShortcutLayer,
  isAppShortcutEnabled,
  isMacPlatform,
  isPrimaryShortcut,
  isPrimaryShiftShortcut
} from '@renderer/lib/keyboardShortcuts'
import {
  applyEditorColorPalette,
  EDITOR_PALETTE_PREVIEW_CHANNEL,
  isEditorColorPalette,
  resolveEditorColorScheme,
  type EditorPalettePreviewMessage
} from '@renderer/lib/editorColorScheme'
import type { CatalogDestination } from '@renderer/lib/quickSearch/documents'
import { searchId, type SearchHit, type SearchScope } from '@renderer/lib/quickSearch/types'
import { flushSearchVisits, loadSearchVisits, recordSearchVisit } from '@renderer/lib/quickSearch/visits'

type QueryPrompt =
  | {
      kind: 'connect'
      query: StoredQuerySelection
      connectionId: string
      connectionName: string
      connecting: boolean
      error?: string
    }
  | { kind: 'missing'; query: StoredQuerySelection; connectionName?: string }

export default function App(): React.JSX.Element {
  const bootstrap = useAppStore((s) => s.bootstrap)
  const connections = useAppStore((s) => s.connections)
  const activeConnectionId = useAppStore((s) => s.activeConnectionId)
  const statuses = useAppStore((s) => s.statuses)
  const theme = useAppStore((s) => s.settings.theme)
  const language = useAppStore((s) => s.settings.language)
  const sidebarWidth = useAppStore((s) => s.settings.sidebarWidth)
  const dataFontSize = useAppStore((s) => s.settings.dataFontSize)
  const activeEditorColorSchemeId = useAppStore((s) => s.settings.activeEditorColorSchemeId)
  const editorColorSchemes = useAppStore((s) => s.settings.editorColorSchemes)
  const keyboardShortcutsEnabled = useAppStore((s) => s.settings.keyboardShortcutsEnabled)
  const disabledKeyboardShortcuts = useAppStore((s) => s.settings.disabledKeyboardShortcuts)
  const connect = useAppStore((s) => s.connect)
  const applyQuery = useAppStore((s) => s.applyQuery)
  const openSettings = useAppStore((s) => s.openSettings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const { t } = useTranslation()
  const isDark = useIsDark()
  const shortcutHints = useShortcutHints(keyboardShortcutsEnabled)

  const [view, setView] = useState<ExplorerView>('connections')
  const [explorerOpen, setExplorerOpen] = useState(true)
  const appBodyRef = useRef<HTMLDivElement>(null)
  const explorerWasOpen = useRef(explorerOpen)
  useEffect(() => {
    if (explorerWasOpen.current === explorerOpen) return
    explorerWasOpen.current = explorerOpen
    if (hasOpenShortcutLayer()) return
    const selector = explorerOpen ? '.explorer-head .side-head-action' : '.sidebar-toggle-open'
    appBodyRef.current?.querySelector<HTMLButtonElement>(selector)?.focus({ preventScroll: true })
  }, [explorerOpen])
  const [queryPrompt, setQueryPrompt] = useState<QueryPrompt | null>(null)
  const [palettePreview, setPalettePreview] = useState<EditorPalettePreviewMessage['palette']>(null)
  const [newConnectionRequested, setNewConnectionRequested] = useState(false)
  const [searchScope, setSearchScope] = useState<SearchScope | null>(null)
  const [catalogReveal, setCatalogReveal] = useState<CatalogDestination | null>(null)
  const queryAttempt = useRef(0)
  const editorFocusFrame = useRef<number | undefined>(undefined)

  const focusEditor = (): void => {
    if (editorFocusFrame.current !== undefined) cancelAnimationFrame(editorFocusFrame.current)
    editorFocusFrame.current = requestAnimationFrame(() => {
      editorFocusFrame.current = requestAnimationFrame(() => {
        editorFocusFrame.current = undefined
        if (!hasOpenShortcutLayer()) {
          document.querySelector<HTMLElement>('.cm-content[contenteditable=true]')?.focus({ preventScroll: true })
        }
      })
    })
  }
  useEffect(() => () => {
    if (editorFocusFrame.current !== undefined) cancelAnimationFrame(editorFocusFrame.current)
  }, [])

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  useEffect(() => {
    loadSearchVisits()
    const unsubscribe = useAppStore.subscribe((state, previous) => {
      if (state.initializing) return
      const tab = getActiveTab(state)
      const previousTab = getActiveTab(previous)
      if (previous.initializing || state.activeTabId !== previous.activeTabId) {
        recordSearchVisit(searchId('queries', tab.id))
      }
      if (
        tab.activeResultId &&
        (state.activeTabId !== previous.activeTabId || tab.activeResultId !== previousTab.activeResultId)
      ) {
        recordSearchVisit(searchId('data', tab.activeResultId))
      }
    })
    window.addEventListener('beforeunload', flushSearchVisits)
    return () => {
      unsubscribe()
      window.removeEventListener('beforeunload', flushSearchVisits)
      flushSearchVisits()
    }
  }, [])

  useEffect(
    () =>
      window.api.session.onStatusChanged((status) => {
        useAppStore.getState().syncSessionStatus(status)
      }),
    []
  )

  // Apply the persisted language preference (resolving 'system' to a locale).
  // Mirrors the theme effect below; setLanguage handles the i18next swap.
  useEffect(() => {
    setLanguage(language)
  }, [language])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.isComposing || hasOpenShortcutLayer()) return
      const isMac = isMacPlatform()
      const quickSearch =
        isAppShortcutEnabled(keyboardShortcutsEnabled, disabledKeyboardShortcuts, 'quickSearch') &&
        isPrimaryShortcut(e, 'k', isMac)
      const tabSearch =
        isAppShortcutEnabled(keyboardShortcutsEnabled, disabledKeyboardShortcuts, 'tabSearch') &&
        isPrimaryShiftShortcut(e, 'a', isMac)
      if (quickSearch || tabSearch) {
        e.preventDefault()
        e.stopPropagation()
        if (!e.repeat) setSearchScope(tabSearch ? 'queries' : 'all')
        return
      }
      if (
        isAppShortcutEnabled(keyboardShortcutsEnabled, disabledKeyboardShortcuts, 'openSettings') &&
        isPrimaryShortcut(e, ',', isMac)
      ) {
        e.preventDefault()
        void openSettings()
        return
      }
      if (
        isAppShortcutEnabled(keyboardShortcutsEnabled, disabledKeyboardShortcuts, 'newConnection') &&
        !e.repeat &&
        isPrimaryShortcut(e, 'n', isMac)
      ) {
        e.preventDefault()
        setView('connections')
        setExplorerOpen(true)
        setNewConnectionRequested(true)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [disabledKeyboardShortcuts, keyboardShortcutsEnabled, openSettings])

  // Reflect the persisted theme onto the document root, which drives the
  // `[data-theme]` token cascade in styles/tokens.css. 'system' resolves to the OS
  // appearance and re-resolves live when the OS toggles light/dark.
  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      const resolved = theme === 'system' ? (mql.matches ? 'dark' : 'light') : theme
      document.documentElement.setAttribute('data-theme', resolved)
    }
    apply()
    if (theme !== 'system') return
    mql.addEventListener('change', apply)
    return () => mql.removeEventListener('change', apply)
  }, [theme])

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    const channel = new BroadcastChannel(EDITOR_PALETTE_PREVIEW_CHANNEL)
    const receive = (event: MessageEvent<EditorPalettePreviewMessage>): void => {
      if (event.data?.palette === null) setPalettePreview(null)
      else if (isEditorColorPalette(event.data?.palette)) setPalettePreview(event.data.palette)
    }
    channel.addEventListener('message', receive)
    return () => {
      channel.removeEventListener('message', receive)
      channel.close()
    }
  }, [])

  useEffect(() => {
    const saved = resolveEditorColorScheme({ activeEditorColorSchemeId, editorColorSchemes })
    applyEditorColorPalette(document.documentElement, palettePreview ?? saved[isDark ? 'dark' : 'light'])
  }, [activeEditorColorSchemeId, editorColorSchemes, isDark, palettePreview])

  const finishQueryLoad = (query: StoredQuerySelection, connectionId: string): void => {
    applyQuery(query.code, query.database, connectionId)
    if (query.visitId) {
      recordSearchVisit(query.visitId)
      focusEditor()
    }
    setQueryPrompt(null)
  }

  const requestQueryLoad = (query: StoredQuerySelection): void => {
    const connectionId = query.connectionId ?? activeConnectionId
    const connection = connections.find((item) => item.id === connectionId)
    if (!connectionId || !connection) {
      setQueryPrompt({
        kind: 'missing',
        query,
        connectionName: query.connectionId ? query.connectionName : undefined
      })
      return
    }
    if (statuses[connectionId]?.state === 'connected') {
      finishQueryLoad(query, connectionId)
      return
    }
    setQueryPrompt({
      kind: 'connect',
      query,
      connectionId,
      connectionName: connection.name,
      connecting: false
    })
  }

  const confirmQueryConnection = async (): Promise<void> => {
    if (queryPrompt?.kind !== 'connect' || queryPrompt.connecting) return
    const prompt = queryPrompt
    const attempt = ++queryAttempt.current
    setQueryPrompt({ ...prompt, connecting: true, error: undefined })
    await connect(prompt.connectionId)
    if (queryAttempt.current !== attempt) return
    const status = useAppStore.getState().statuses[prompt.connectionId]
    if (status?.state === 'connected') {
      finishQueryLoad(prompt.query, prompt.connectionId)
      return
    }
    setQueryPrompt({
      ...prompt,
      connecting: false,
      error: status?.error ?? t('queryNavigation.connectFailed')
    })
  }

  const closeQueryPrompt = (): void => {
    queryAttempt.current += 1
    setQueryPrompt(null)
  }

  const selectSearchResult = (hit: SearchHit, destination?: CatalogDestination): void => {
    const state = useAppStore.getState()
    const [, id] = JSON.parse(hit.id) as [string, string]
    setSearchScope(null)
    if (hit.group === 'connections' && destination) {
      state.revealCatalog(destination.connectionId, destination.ancestors)
      setView('connections')
      setExplorerOpen(true)
      setCatalogReveal({ ...destination })
      recordSearchVisit(hit.id)
    } else if (hit.group === 'queries') {
      if (state.tabs.some((tab) => tab.id === id)) {
        state.setActiveTab(id)
        recordSearchVisit(hit.id)
        focusEditor()
      }
    } else if (hit.group === 'data') {
      const tab = state.tabs.find((tab) => tab.results.some((result) => result.id === id))
      if (tab) {
        state.setActiveResultTab(id, tab.id)
        recordSearchVisit(hit.id)
        focusEditor()
      }
    } else if (hit.group === 'saved' || hit.group === 'history') {
      const query =
        hit.group === 'saved'
          ? state.savedQueries.find((query) => query.id === id)
          : state.history.find((entry) => entry.id === id)
      if (query) {
        requestQueryLoad({
          ...query,
          visitId: hit.id,
          connectionId: query.connectionId ?? undefined,
          connectionName:
            state.connections.find((connection) => connection.id === query.connectionId)?.name ?? query.connectionId
        })
      }
    }
  }

  return (
    <div
      className="app"
      data-shortcut-hints={shortcutHints ?? undefined}
      style={{ '--data-font-size': `${dataFontSize}px` } as CSSProperties}
    >
      <div ref={appBodyRef} className={explorerOpen ? 'app-body' : 'app-body explorer-collapsed'}>
        <Collapsible open={explorerOpen} axis="horizontal" className="explorer-disclosure">
          <Explorer
            view={view}
            onViewChange={setView}
            onQueryLoad={requestQueryLoad}
            onSearch={() => setSearchScope('all')}
            reveal={catalogReveal}
            onCollapse={() => setExplorerOpen(false)}
            onSettings={() => void openSettings()}
            newConnectionRequested={newConnectionRequested}
            onNewConnectionRequestHandled={() => setNewConnectionRequested(false)}
          />
        </Collapsible>
        {explorerOpen && (
          <ResizeHandle
            axis="x"
            cssVar="--sidebar-width"
            className="resize-handle--col"
            value={sidebarWidth}
            min={200}
            // Always leave the work area at least ~480px; mirrors the CSS calc cap.
            getMax={() => Math.max(200, window.innerWidth - 480)}
            onCommit={(px) => void updateSettings({ sidebarWidth: px })}
            ariaLabel={t('app.resizeSidebar')}
          />
        )}
        <ShellWorkspace shortcutHints={shortcutHints} onSearch={() => setSearchScope('queries')} />
        {!explorerOpen && (
          <div className="sidebar-toggle-slot">
            <button
              className="sidebar-toggle-open"
              aria-label={t('explorer.expand')}
              onClick={() => setExplorerOpen(true)}
            >
              <PanelLeftOpen size={17} />
            </button>
          </div>
        )}
      </div>
      {searchScope && (
        <QuickSearch
          initialScope={searchScope}
          onClose={() => setSearchScope(null)}
          onSelect={selectSearchResult}
        />
      )}
      {queryPrompt && (
        <Modal
          small
          title={
            queryPrompt.kind === 'connect' ? t('queryNavigation.connectTitle') : t('queryNavigation.unavailableTitle')
          }
          onClose={closeQueryPrompt}
          footer={
            <>
              <span className="spacer" />
              <Button onClick={closeQueryPrompt}>{t('queryNavigation.cancel')}</Button>
              {queryPrompt.kind === 'connect' ? (
                <Button variant="primary" busy={queryPrompt.connecting} onClick={() => void confirmQueryConnection()}>
                  {t('queryNavigation.connect')}
                </Button>
              ) : (
                <Button
                  variant="primary"
                  onClick={() => {
                    closeQueryPrompt()
                    setView('connections')
                    setExplorerOpen(true)
                  }}
                >
                  {t('queryNavigation.goToConnections')}
                </Button>
              )}
            </>
          }
        >
          {queryPrompt.kind === 'connect' ? (
            <>
              <p>
                {t('queryNavigation.connectMessage', {
                  name: queryPrompt.connectionName
                })}
              </p>
              {queryPrompt.error && <p className="mt-3 text-sm text-destructive">{queryPrompt.error}</p>}
            </>
          ) : (
            <p>
              {queryPrompt.connectionName
                ? t('queryNavigation.connectionMissing', {
                    name: queryPrompt.connectionName
                  })
                : t('queryNavigation.noConnection')}
            </p>
          )}
        </Modal>
      )}
      <Toaster />
      <TooltipLayer />
    </div>
  )
}
