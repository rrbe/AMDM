import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { PanelLeftOpen } from 'lucide-react'
import { useAppStore } from '@renderer/store/useAppStore'
import { setLanguage } from '@renderer/i18n'
import { Explorer, type ExplorerView } from '@renderer/components/explorer/Explorer'
import type { StoredQuerySelection } from '@renderer/components/explorer/SavedQueriesPanel'
import { ShellWorkspace } from '@renderer/components/shell/ShellWorkspace'
import { Toaster } from '@renderer/components/common/Toaster'
import { TooltipLayer } from '@renderer/components/common/TooltipLayer'
import { ResizeHandle } from '@renderer/components/common/ResizeHandle'
import { Modal } from '@renderer/components/common/Modal'
import { Button } from '@renderer/components/common/Button'
import { useIsDark } from '@renderer/lib/useIsDark'
import {
  applyEditorColorPalette,
  EDITOR_PALETTE_PREVIEW_CHANNEL,
  isEditorColorPalette,
  resolveEditorColorScheme,
  type EditorPalettePreviewMessage
} from '@renderer/lib/editorColorScheme'

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

function openSettingsWindow(): void {
  void window.api.app.openSettings()
}

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
  const connect = useAppStore((s) => s.connect)
  const applyQuery = useAppStore((s) => s.applyQuery)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const { t } = useTranslation()
  const isDark = useIsDark()

  const [view, setView] = useState<ExplorerView>('connections')
  const [explorerOpen, setExplorerOpen] = useState(true)
  const [queryPrompt, setQueryPrompt] = useState<QueryPrompt | null>(null)
  const [palettePreview, setPalettePreview] = useState<EditorPalettePreviewMessage['palette']>(null)
  const queryAttempt = useRef(0)

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

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
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key === ',') {
        e.preventDefault()
        openSettingsWindow()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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

  return (
    <div className="app" style={{ '--data-font-size': `${dataFontSize}px` } as CSSProperties}>
      <div className={explorerOpen ? 'app-body' : 'app-body explorer-collapsed'}>
        {explorerOpen && (
          <Explorer
            view={view}
            onViewChange={setView}
            onQueryLoad={requestQueryLoad}
            onCollapse={() => setExplorerOpen(false)}
            onSettings={openSettingsWindow}
          />
        )}
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
        <ShellWorkspace />
        {!explorerOpen && (
          <div className="sidebar-toggle-slot">
            <button
              className="sidebar-toggle-open"
              data-tip={t('explorer.expand')}
              aria-label={t('explorer.expand')}
              onClick={() => setExplorerOpen(true)}
            >
              <PanelLeftOpen size={17} />
            </button>
          </div>
        )}
      </div>
      {queryPrompt && (
        <Modal
          small
          title={
            queryPrompt.kind === 'connect'
              ? t('queryNavigation.connectTitle')
              : t('queryNavigation.unavailableTitle')
          }
          onClose={closeQueryPrompt}
          footer={
            <>
              <span className="spacer" />
              <Button onClick={closeQueryPrompt}>{t('queryNavigation.cancel')}</Button>
              {queryPrompt.kind === 'connect' ? (
                <Button
                  variant="primary"
                  busy={queryPrompt.connecting}
                  onClick={() => void confirmQueryConnection()}
                >
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
              {queryPrompt.error && (
                <p className="mt-3 text-sm text-destructive">{queryPrompt.error}</p>
              )}
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
