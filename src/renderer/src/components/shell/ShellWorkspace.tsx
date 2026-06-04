import { useMemo, useState } from 'react'
import { useAppStore } from '@renderer/store/useAppStore'
import { ShellEditor } from './ShellEditor'
import { SaveQueryModal } from './SaveQueryModal'
import { ResultPanel } from '@renderer/components/results/ResultPanel'
import { ResizeHandle } from '@renderer/components/common/ResizeHandle'
import { Button } from '@renderer/components/common/Button'

/**
 * The main work area: header (active connection + db selector + Run), the lazy
 * CodeMirror editor, and the result panel below.
 */
export function ShellWorkspace(): JSX.Element {
  const activeConnectionId = useAppStore((s) => s.activeConnectionId)
  const connections = useAppStore((s) => s.connections)
  const catalogs = useAppStore((s) => s.catalogs)
  const activeDatabase = useAppStore((s) => s.activeDatabase)
  const code = useAppStore((s) => s.code)
  const running = useAppStore((s) => s.running)
  const setCode = useAppStore((s) => s.setCode)
  const formatCode = useAppStore((s) => s.formatCode)
  const setActiveDatabase = useAppStore((s) => s.setActiveDatabase)
  const runShell = useAppStore((s) => s.runShell)
  const stopShell = useAppStore((s) => s.stopShell)
  const runExplain = useAppStore((s) => s.runExplain)
  const editorHeight = useAppStore((s) => s.settings.editorHeight)
  const updateSettings = useAppStore((s) => s.updateSettings)

  const [showSave, setShowSave] = useState(false)

  const conn = connections.find((c) => c.id === activeConnectionId)
  const busy = running || !code.trim()
  const databases = activeConnectionId ? catalogs[activeConnectionId]?.databases ?? [] : []

  // Database options: loaded databases, ensuring the active one is always shown.
  const dbOptions = useMemo(() => {
    const names = databases.map((d) => d.name)
    if (activeDatabase && !names.includes(activeDatabase)) names.unshift(activeDatabase)
    return names
  }, [databases, activeDatabase])

  return (
    <div className="work">
      <div className="work-header app-drag">
        <span className="conn-title">{conn?.name ?? 'Shell'}</span>
        <select
          className="db-select"
          value={activeDatabase}
          onChange={(e) => setActiveDatabase(e.target.value)}
          data-tip="Active database"
        >
          {dbOptions.length === 0 && <option value="">(no database)</option>}
          {activeDatabase === '' && dbOptions.length > 0 && <option value="">Select database…</option>}
          {dbOptions.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <span className="spacer" />
        <Button disabled={busy} onClick={() => setShowSave(true)} data-tip="Save current query">
          Save
        </Button>
        <Button disabled={busy} onClick={() => void runExplain()} data-tip="Run explain('executionStats')">
          Explain
        </Button>
        {running ? (
          // Swap Run → Stop while a query is in flight, so a runaway
          // find/aggregate can be cancelled server-side (driver AbortSignal).
          <Button variant="danger" onClick={() => void stopShell()} data-tip="停止执行">
            ■ 停止
          </Button>
        ) : (
          <Button variant="primary" disabled={busy} onClick={() => void runShell()}>
            ▶ Run
          </Button>
        )}
      </div>

      <ShellEditor
        value={code}
        onChange={setCode}
        onRun={() => void runShell()}
        onRunStatement={(c) => void runShell(c)}
        onSave={() => setShowSave(true)}
        onExplain={() => void runExplain()}
        onFormat={() => void formatCode()}
        onStop={() => void stopShell()}
        running={running}
        busy={busy}
      />

      <ResizeHandle
        axis="y"
        cssVar="--editor-height"
        className="resize-handle--row"
        value={editorHeight}
        min={80}
        // Keep the result panel usable (≥~180px); mirrors the CSS calc cap.
        getMax={() => Math.max(80, window.innerHeight - 300)}
        onCommit={(px) => void updateSettings({ editorHeight: px })}
        ariaLabel="Resize editor"
      />

      <ResultPanel />

      {showSave && <SaveQueryModal onClose={() => setShowSave(false)} />}
    </div>
  )
}
