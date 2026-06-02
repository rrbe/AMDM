import { useEffect } from 'react'
import { useAppStore } from '@renderer/store/useAppStore'
import { Sidebar } from '@renderer/components/sidebar/Sidebar'
import { CatalogTree } from '@renderer/components/catalog/CatalogTree'
import { ShellWorkspace } from '@renderer/components/shell/ShellWorkspace'
import { ErrorToast } from '@renderer/components/common/ErrorToast'

/**
 * Top-level 3-pane layout (NoSQLBooster-style):
 *   [ Sidebar (connections) | Catalog tree | Shell work area ]
 * The catalog + work area only render meaningfully when a connection is active.
 */
export default function App(): JSX.Element {
  const bootstrap = useAppStore((s) => s.bootstrap)
  const activeConnectionId = useAppStore((s) => s.activeConnectionId)
  const statuses = useAppStore((s) => s.statuses)

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  const activeConnected =
    activeConnectionId !== null && statuses[activeConnectionId]?.state === 'connected'

  return (
    <div className="app">
      <Sidebar />
      <CatalogTree />
      {activeConnected ? <ShellWorkspace /> : <WorkspaceEmptyState />}
      <ErrorToast />
    </div>
  )
}

function WorkspaceEmptyState(): JSX.Element {
  const connections = useAppStore((s) => s.connections)
  return (
    <div className="work">
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
