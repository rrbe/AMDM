import { useEffect } from 'react'
import { useAppStore } from '@renderer/store/useAppStore'
import { Explorer } from '@renderer/components/explorer/Explorer'
import { ShellWorkspace } from '@renderer/components/shell/ShellWorkspace'
import { ErrorToast } from '@renderer/components/common/ErrorToast'
import { NoticeToast } from '@renderer/components/common/NoticeToast'
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
  const sidebarWidth = useAppStore((s) => s.settings.sidebarWidth)
  const updateSettings = useAppStore((s) => s.updateSettings)

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

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
        ariaLabel="Resize sidebar"
      />
      {activeConnected ? <ShellWorkspace /> : <WorkspaceEmptyState />}
      <ErrorToast />
      <NoticeToast />
    </div>
  )
}

function WorkspaceEmptyState(): JSX.Element {
  const connections = useAppStore((s) => s.connections)
  return (
    <div className="work">
      <div className="work-titlebar app-drag" />
      <div className="empty-state">
        <h2>Mongo Shell GUI</h2>
        {connections.length === 0 ? (
          <p>
            No connections yet. Use the <strong>+</strong> in the sidebar to create your first
            MongoDB connection.
          </p>
        ) : (
          <p>
            Select a connection and <strong>double-click</strong> (or press Connect) to open a
            shell. Browsing a collection inserts a starter query — it never auto-runs.
          </p>
        )}
      </div>
    </div>
  )
}
