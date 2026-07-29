import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  ChevronRight,
  LoaderCircle,
  PanelRight,
  Play,
  Plus,
  Save,
  X,
  Workflow
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAppStore, getActiveTab } from '@renderer/store/useAppStore'
import { tabCollection, tabLabel } from '@renderer/lib/tabs'
import { ShellEditor } from './ShellEditor'
import { SaveQueryModal } from './SaveQueryModal'
import { PipelineBuilderPanel } from './pipeline/PipelineBuilderPanel'
import { ContextPanel } from './ContextPanel'
import { ResultPanel } from '@renderer/components/results/ResultPanel'
import { ResizeHandle } from '@renderer/components/common/ResizeHandle'
import { Button } from '@renderer/components/common/Button'
import { Select } from '@renderer/components/ui/Select'

/**
 * The main work area: a tab strip, header (active connection + db selector +
 * Run), the lazy CodeMirror editor, and the result panel below. Each tab owns
 * its own code/result/db/run state (see the store's `tabs`).
 */
export function ShellWorkspace(): JSX.Element {
  const { t } = useTranslation()
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
  const togglePipeline = useAppStore((s) => s.togglePipeline)
  const pipelineOpen = useAppStore((s) => getActiveTab(s).pipeline?.open ?? false)
  const editorHeight = useAppStore((s) => s.settings.editorHeight)
  const updateSettings = useAppStore((s) => s.updateSettings)

  const [showSave, setShowSave] = useState(false)
  const [contextOpen, setContextOpen] = useState(true)
  const selectedCode = useRef<string>()

  const conn = connections.find((c) => c.id === activeConnectionId)
  const targetCollection = useAppStore((s) => tabCollection(getActiveTab(s)))
  const busy = running || !code.trim()
  const databases = activeConnectionId ? catalogs[activeConnectionId]?.databases ?? [] : []
  const runEditor = (): void => {
    void runShell(selectedCode.current)
  }

  useEffect(() => {
    selectedCode.current = undefined
  }, [activeTabId])

  // Database options: loaded databases, ensuring the active one is always shown.
  const dbOptions = useMemo(() => {
    const names = databases.map((d) => d.name)
    if (activeDatabase && !names.includes(activeDatabase)) names.unshift(activeDatabase)
    return names
  }, [databases, activeDatabase])

  return (
    <div className="work">
      <TabBar />
      <div className="shell-body">
        <main className="shell-main">
          <div className="work-header">
            <div className="work-breadcrumb">
              <span className="conn-title">{conn?.name ?? t('shell.fallbackConnTitle')}</span>
              <ChevronRight size={13} aria-hidden />
              <Select
                className="db-select"
                value={activeDatabase}
                onChange={setActiveDatabase}
                options={dbOptions.map((name) => ({ label: name, value: name }))}
                placeholder={dbOptions.length === 0 ? t('shell.noDatabase') : t('shell.selectDatabase')}
                disabled={dbOptions.length === 0}
                aria-label={t('shell.activeDatabaseTip')}
                data-tip={t('shell.activeDatabaseTip')}
              />
              {targetCollection && (
                <>
                  <ChevronRight size={13} aria-hidden />
                  <span className="collection-title">{targetCollection}</span>
                </>
              )}
            </div>

            <div className="work-actions">
              {running ? (
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => void stopShell()}
                  data-tip={t('shell.stopTip')}
                >
                  <LoaderCircle className="animate-spin" aria-hidden /> {t('shell.stopTip')}
                </Button>
              ) : (
                <Button size="sm" variant="primary" disabled={busy} onClick={runEditor}>
                  <Play aria-hidden /> {t('shell.runBtn')}
                </Button>
              )}
              <button
                className="work-icon-btn"
                disabled={busy}
                onClick={() => void runExplain()}
                data-tip={t('shell.explainTip')}
                aria-label={t('shell.explainBtn')}
              >
                <Activity size={15} />
              </button>
              <button
                className="work-icon-btn"
                disabled={busy}
                onClick={() => setShowSave(true)}
                data-tip={t('shell.saveQueryTip')}
                aria-label={t('shell.saveBtn')}
              >
                <Save size={15} />
              </button>
              <button
                className={pipelineOpen ? 'work-icon-btn pipeline-toggle is-active' : 'work-icon-btn pipeline-toggle'}
                onClick={() => {
                  if (!pipelineOpen) setContextOpen(true)
                  togglePipeline()
                }}
                data-tip={t('builder.toggleTip')}
                aria-label={t('builder.title')}
              >
                <Workflow size={15} />
              </button>
              <button
                className={contextOpen ? 'work-icon-btn context-toggle is-active' : 'work-icon-btn context-toggle'}
                onClick={() => setContextOpen((open) => !open)}
                data-tip={t('context.toggle')}
                aria-label={t('context.toggle')}
              >
                <PanelRight size={15} />
              </button>
            </div>
          </div>

          {/* Key the editor by tab id so each tab gets its own CodeMirror
              instance (isolated undo history / selection). */}
          <div className="editor-row">
            <ShellEditor
              key={activeTabId}
              value={code}
              onChange={setCode}
              onSelectionChange={(selected) => {
                selectedCode.current = selected
              }}
              onRun={(selected) => void runShell(selected)}
              onRunStatement={(c) => void runShell(c)}
              onSave={() => setShowSave(true)}
              onExplain={() => void runExplain()}
              onFormat={() => void formatCode()}
              onStop={() => void stopShell()}
              running={running}
              busy={busy}
            />
          </div>

          <ResizeHandle
            axis="y"
            cssVar="--editor-height"
            className="resize-handle--row"
            value={editorHeight}
            min={80}
            // Keep the result panel usable (≥~180px); mirrors the CSS calc cap.
            getMax={() => Math.max(80, window.innerHeight - 300)}
            onCommit={(px) => void updateSettings({ editorHeight: px })}
            ariaLabel={t('shell.resizeEditor')}
          />

          <ResultPanel />
        </main>

        {contextOpen && (
          <aside className={pipelineOpen ? 'context-rail is-pipeline' : 'context-rail'}>
            {pipelineOpen ? (
              <PipelineBuilderPanel />
            ) : (
              <ContextPanel onClose={() => setContextOpen(false)} />
            )}
          </aside>
        )}
      </div>

      {showSave && <SaveQueryModal onClose={() => setShowSave(false)} />}
    </div>
  )
}

/**
 * The query-tab strip: one chip per open tab (label derived from its code), a
 * running dot while it executes, a close ✕, and a trailing "+" to open a tab.
 */
function TabBar(): JSX.Element {
  const { t } = useTranslation()
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
    <div className="tab-bar app-drag">
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
              aria-label={t('shell.closeTab')}
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
      <button className="qtab-new" data-tip={t('shell.newTabTip')} aria-label={t('shell.newTabLabel')} onClick={() => newTab()}>
        <Plus size={14} />
      </button>
    </div>
  )
}
