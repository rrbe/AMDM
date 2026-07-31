import { useEffect, useRef, useState } from 'react'
import {
  Activity,
  ChevronRight,
  LoaderCircle,
  PanelRightClose,
  PanelRightOpen,
  Play,
  Plus,
  Save,
  X
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAppStore, getActiveTab } from '@renderer/store/useAppStore'
import { tabCollection, tabLabel } from '@renderer/lib/tabs'
import { ShellEditor } from './ShellEditor'
import { SaveQueryModal } from './SaveQueryModal'
import { ContextPanel } from './ContextPanel'
import { ResultPanel } from '@renderer/components/results/ResultPanel'
import { ResizeHandle } from '@renderer/components/common/ResizeHandle'
import { Button } from '@renderer/components/common/Button'

/**
 * The main work area: a tab strip, header (active connection + database +
 * Run), the lazy CodeMirror editor, and the result panel below. Each tab owns
 * its own code/result/db/run state (see the store's `tabs`).
 */
export function ShellWorkspace(): JSX.Element {
  const { t } = useTranslation()
  const activeConnectionId = useAppStore((s) => s.activeConnectionId)
  const connections = useAppStore((s) => s.connections)
  const activeDatabase = useAppStore((s) => getActiveTab(s).activeDatabase)
  const code = useAppStore((s) => getActiveTab(s).code)
  const running = useAppStore((s) => getActiveTab(s).running)
  const activeTabId = useAppStore((s) => s.activeTabId)
  const setCode = useAppStore((s) => s.setCode)
  const formatCode = useAppStore((s) => s.formatCode)
  const runShell = useAppStore((s) => s.runShell)
  const stopShell = useAppStore((s) => s.stopShell)
  const runExplain = useAppStore((s) => s.runExplain)
  const editorHeight = useAppStore((s) => s.settings.editorHeight)
  const updateSettings = useAppStore((s) => s.updateSettings)

  const [showSave, setShowSave] = useState(false)
  const [contextOpen, setContextOpen] = useState(true)
  const [resultsExpanded, setResultsExpanded] = useState(false)
  const selectedCode = useRef<string>()

  const conn = connections.find((c) => c.id === activeConnectionId)
  const targetCollection = useAppStore((s) => tabCollection(getActiveTab(s)))
  const busy = running || !code.trim()
  const runEditor = (): void => {
    void runShell(selectedCode.current)
  }

  useEffect(() => {
    selectedCode.current = undefined
  }, [activeTabId])

  return (
    <div className="work">
      <TabBar />
      <div className="shell-body">
        <main className={resultsExpanded ? 'shell-main results-expanded' : 'shell-main'}>
          <div className="work-header">
            <div className="work-breadcrumb">
              <span className="conn-title">{conn?.name ?? t('shell.fallbackConnTitle')}</span>
              <ChevronRight size={13} aria-hidden />
              <span className="database-title">{activeDatabase || t('shell.noDatabase')}</span>
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
                className="work-icon-btn context-toggle"
                onClick={() => setContextOpen((open) => !open)}
                data-tip={t(contextOpen ? 'context.close' : 'context.open')}
                aria-label={t(contextOpen ? 'context.close' : 'context.open')}
              >
                {contextOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
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

          <ResultPanel expanded={resultsExpanded} onExpandedChange={setResultsExpanded} />
        </main>

        {contextOpen && (
          <aside className="context-rail">
            <ContextPanel />
          </aside>
        )}
      </div>

      {showSave && <SaveQueryModal onClose={() => setShowSave(false)} />}
    </div>
  )
}

/**
 * The query-tab strip: one chip per open tab (label derived from its code), a
 * fixed status slot (spinner / failure dot), a close ✕, and a trailing "+".
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
          >
            <span className="qtab-status" aria-hidden>
              {tab.running ? (
                <LoaderCircle className="qtab-spinner animate-spin" />
              ) : tab.runFailed ? (
                <span className="qtab-error-dot" />
              ) : null}
            </span>
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
        <button className="qtab-new" data-tip={t('shell.newTabTip')} aria-label={t('shell.newTabLabel')} onClick={() => newTab()}>
          <Plus size={14} />
        </button>
      </div>
    </div>
  )
}
