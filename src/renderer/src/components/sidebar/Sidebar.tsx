import { useState } from 'react'
import type { ConnectionConfig } from '@shared/types'
import { useAppStore } from '@renderer/store/useAppStore'
import { ConnectionForm } from './ConnectionForm'

/**
 * Left sidebar: a flat list of connections. Each connection carries its own
 * optional preset color (shown as a left bar + dot). Double-click a connection
 * to connect + select it.
 */
export function Sidebar(): JSX.Element {
  const connections = useAppStore((s) => s.connections)
  const [connForm, setConnForm] = useState<{ open: boolean; editing?: ConnectionConfig }>({
    open: false
  })

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <span>CONNECTIONS</span>
        <div className="sidebar-actions">
          <button className="ghost" title="New connection" onClick={() => setConnForm({ open: true })}>
            +
          </button>
        </div>
      </div>

      <div className="sidebar-body">
        {connections.length === 0 && (
          <div style={{ padding: '14px', color: 'var(--fg-3)', fontSize: 'var(--fs-sm)' }}>
            No connections. Click + to add one.
          </div>
        )}

        {connections.map((c) => (
          <ConnectionRow key={c.id} conn={c} onEdit={() => setConnForm({ open: true, editing: c })} />
        ))}
      </div>

      {connForm.open && (
        <ConnectionForm editing={connForm.editing} onClose={() => setConnForm({ open: false })} />
      )}
    </div>
  )
}

function ConnectionRow({
  conn,
  onEdit
}: {
  conn: ConnectionConfig
  onEdit: () => void
}): JSX.Element {
  const activeConnectionId = useAppStore((s) => s.activeConnectionId)
  // Select the STABLE raw status (object or undefined). Deriving the fallback
  // inside the selector would return a new object each call and make zustand v5
  // loop ("getSnapshot should be cached"). Derive it outside instead.
  const status = useAppStore((s) => s.statuses[conn.id])
  const state = status?.state ?? 'disconnected'
  const connect = useAppStore((s) => s.connect)
  const disconnect = useAppStore((s) => s.disconnect)
  const setActiveConnection = useAppStore((s) => s.setActiveConnection)
  const deleteConnection = useAppStore((s) => s.deleteConnection)

  const isActive = activeConnectionId === conn.id
  const isConnected = state === 'connected'

  const sub = conn.useSrv ? `srv · ${conn.host}` : `${conn.host}:${conn.port ?? 27017}`

  return (
    <div
      className={isActive ? 'conn-item active' : 'conn-item'}
      title={state === 'error' ? status?.error : sub}
      onClick={() => setActiveConnection(conn.id)}
      onDoubleClick={() => void connect(conn.id)}
      style={conn.color ? { borderLeft: `3px solid ${conn.color}`, paddingLeft: 7 } : undefined}
    >
      <span className={`state-dot ${state}`} />
      {conn.color && <span className="color-dot" style={{ background: conn.color }} />}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <div className="conn-name">{conn.name}</div>
        <div className="conn-sub">{sub}</div>
      </div>
      <div className="conn-row-actions">
        {isConnected ? (
          <button
            className="ghost"
            title="Disconnect"
            onClick={(e) => {
              e.stopPropagation()
              void disconnect(conn.id)
            }}
          >
            ⏏
          </button>
        ) : (
          <button
            className="ghost"
            title="Connect"
            onClick={(e) => {
              e.stopPropagation()
              void connect(conn.id)
            }}
          >
            ▶
          </button>
        )}
        <button
          className="ghost"
          title="Edit"
          onClick={(e) => {
            e.stopPropagation()
            onEdit()
          }}
        >
          ✎
        </button>
        <button
          className="ghost danger"
          title="Delete"
          onClick={(e) => {
            e.stopPropagation()
            if (confirm(`Delete connection "${conn.name}"?`)) {
              void deleteConnection(conn.id)
            }
          }}
        >
          ✕
        </button>
      </div>
    </div>
  )
}
