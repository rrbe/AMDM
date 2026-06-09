import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@renderer/store/useAppStore'
import { setLanguage } from '@renderer/i18n'
import { Explorer } from '@renderer/components/explorer/Explorer'
import { ShellWorkspace } from '@renderer/components/shell/ShellWorkspace'
import { Toaster } from '@renderer/components/common/Toaster'
import { TooltipLayer } from '@renderer/components/common/TooltipLayer'
import { ResizeHandle } from '@renderer/components/common/ResizeHandle'

/**
 * Top-level 2-pane layout:
 *   [ Explorer (connections + catalog, one tree) | Shell work area ]
 * The work area only renders meaningfully when a connection is active.
 */
export default function App(): JSX.Element {
  const bootstrap = useAppStore((s) => s.bootstrap)
  const activeConnectionId = useAppStore((s) => s.activeConnectionId)
  const statuses = useAppStore((s) => s.statuses)
  const theme = useAppStore((s) => s.settings.theme)
  const language = useAppStore((s) => s.settings.language)
  const sidebarWidth = useAppStore((s) => s.settings.sidebarWidth)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const { t } = useTranslation()

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  // Apply the persisted language preference (resolving 'system' to a locale).
  // Mirrors the theme effect below; setLanguage handles the i18next swap.
  useEffect(() => {
    setLanguage(language)
  }, [language])

  // Reflect the persisted theme onto the document root, which drives the
  // `[data-theme]` token cascade in styles.css. 'system' resolves to the OS
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

  const activeConnected =
    activeConnectionId !== null && statuses[activeConnectionId]?.state === 'connected'

  return (
    <div className="app">
      {/* One consistent, full-width drag strip across the very top of the window
          (the macOS traffic lights live in its reserved left inset). Below it,
          the explorer/work split fills the rest. */}
      <header className="app-titlebar app-drag">
        <span className="app-titlebar-brand">AMDM</span>
      </header>
      <div className="app-body">
        <Explorer />
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
        {activeConnected ? <ShellWorkspace /> : <WorkspaceEmptyState />}
      </div>
      <Toaster />
      <TooltipLayer />
    </div>
  )
}

function WorkspaceEmptyState(): JSX.Element {
  const connections = useAppStore((s) => s.connections)
  const { t } = useTranslation()
  return (
    <div className="work">
      <div className="empty-state">
        <h2>AMDM</h2>
        <p>{connections.length === 0 ? t('app.emptyNoConn') : t('app.emptyHasConn')}</p>
      </div>
    </div>
  )
}
