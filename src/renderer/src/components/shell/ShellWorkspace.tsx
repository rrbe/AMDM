import { useEffect, useMemo, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { useAppStore, getActiveTab } from '@renderer/store/useAppStore'
import { tabLabel } from '@renderer/lib/tabs'
import { ShellEditor } from './ShellEditor'
import { SaveQueryModal } from './SaveQueryModal'
import { ResultPanel } from '@renderer/components/results/ResultPanel'
import { ResizeHandle } from '@renderer/components/common/ResizeHandle'
import { Button } from '@renderer/components/common/Button'

/**
 * The main work area: a tab strip, header (active connection + db selector +
 * Run), the lazy CodeMirror editor, and the result panel below. Each tab owns
 * its own code/result/db/run state (see the store's `tabs`).
 */
export function ShellWorkspace(): JSX.Element {
  const activeConnectionId = useAppStore((s) => s.activeConnectionId)
  const connections = useAppStore((s) => s.connections)
  const catalogs = useAppStore((s) => s.catalogs)
  const activeDatabase = useAppStore((s) => getActiveTab(s).activeDatabase)
  const code = useAppStore((s) => getActiveTab(s).code)
  const running = useAppStore((s) => getActiveTab(s).running)
  const activeTabId = useAppStore((s) => s.activeTabId)
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
      <TabBar />
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

      {/* Key by tab id so each tab gets its own CodeMirror instance (isolated
          undo history / selection); switching tabs swaps in that tab's editor. */}
      <ShellEditor
        key={activeTabId}
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

/**
 * The query-tab strip: one chip per open tab (label derived from its code), a
 * running dot while it executes, a close ✕, and a trailing "+" to open a tab.
 */
function TabBar(): JSX.Element {
  const tabs = useAppStore((s) => s.tabs)
  const activeTabId = useAppStore((s) => s.activeTabId)
  const setActiveTab = useAppStore((s) => s.setActiveTab)
  const closeTab = useAppStore((s) => s.closeTab)
  const newTab = useAppStore((s) => s.newTab)

  // ⌘T / Ctrl+T opens a new query tab (reads the action via getState to keep
  // this listener stable). ⌘W is left alone — it's Electron's window close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 't') {
        e.preventDefault()
        useAppStore.getState().newTab()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="tab-bar">
      <div className="tab-strip">
        {tabs.map((tab, i) => (
          <div
            key={tab.id}
            className={tab.id === activeTabId ? 'qtab active' : 'qtab'}
            onClick={() => setActiveTab(tab.id)}
            onAuxClick={(e) => {
              // Middle-click closes, matching browser tab convention.
              if (e.button === 1) {
                e.preventDefault()
                closeTab(tab.id)
              }
            }}
            data-tip={tabLabel(tab, i)}
          >
            {tab.running && <span className="qtab-dot" aria-hidden />}
            <span className="qtab-label">{tabLabel(tab, i)}</span>
            <button
              className="qtab-close"
              aria-label="关闭标签页"
              onClick={(e) => {
                e.stopPropagation()
                closeTab(tab.id)
              }}
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
      <button className="qtab-new" data-tip="新建查询标签页 (⌘T)" aria-label="新建查询标签页" onClick={() => newTab()}>
        <Plus size={14} />
      </button>
    </div>
  )
}
