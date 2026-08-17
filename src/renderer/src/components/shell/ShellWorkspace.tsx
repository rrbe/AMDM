import { useEffect, useRef, useState } from 'react'
import {
  Activity,
  ChevronDown,
  ChevronRight,
  CircleX,
  LoaderCircle,
  Maximize2,
  Minimize2,
  PanelRightClose,
  PanelRightOpen,
  Play,
  Plus,
  Save
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
import { DocumentTab } from '@renderer/components/common/DocumentTab'
import { Select } from '@renderer/components/ui/Select'
import { Tooltip } from '@renderer/components/ui/Tooltip'
import {
  contextualTabDigitIndex,
  hasOpenShortcutLayer,
  isAppShortcutEnabled,
  isMacPlatform,
  isPrimaryShortcut,
  shortcutRegionFromTarget,
  type ShortcutRegion
} from '@renderer/lib/keyboardShortcuts'

/**
 * The main work area: a tab strip, header (active connection + database +
 * Run), the lazy CodeMirror editor, and the result panel below. Each tab owns
 * its own code/result/db/run state (see the store's `tabs`).
 */
export function ShellWorkspace(): React.JSX.Element {
  const { t } = useTranslation()
  const activeConnectionId = useAppStore((s) => s.activeConnectionId)
  const connections = useAppStore((s) => s.connections)
  const activeDatabase = useAppStore((s) => getActiveTab(s).activeDatabase)
  const code = useAppStore((s) => getActiveTab(s).code)
  const running = useAppStore((s) => getActiveTab(s).running)
  const stopping = useAppStore((s) => getActiveTab(s).stopping)
  const activeConnectionState = useAppStore((s) => {
    const connectionId = getActiveTab(s).connectionId
    return connectionId ? s.statuses[connectionId]?.state : undefined
  })
  const activeTabId = useAppStore((s) => s.activeTabId)
  const setCode = useAppStore((s) => s.setCode)
  const formatCode = useAppStore((s) => s.formatCode)
  const runShell = useAppStore((s) => s.runShell)
  const stopShell = useAppStore((s) => s.stopShell)
  const runExplain = useAppStore((s) => s.runExplain)
  const editorHeight = useAppStore((s) => s.settings.editorHeight)
  const keyboardShortcutsEnabled = useAppStore((s) => s.settings.keyboardShortcutsEnabled)
  const disabledKeyboardShortcuts = useAppStore((s) => s.settings.disabledKeyboardShortcuts)
  const updateSettings = useAppStore((s) => s.updateSettings)

  const [showSave, setShowSave] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)
  const [expandedRegion, setExpandedRegion] = useState<'query' | 'results' | null>(null)
  const selectedCode = useRef<string | undefined>(undefined)
  const lastShortcutRegion = useRef<ShortcutRegion>('query')

  const conn = connections.find((c) => c.id === activeConnectionId)
  const targetCollection = useAppStore((s) => tabCollection(getActiveTab(s)))
  const queryExpanded = expandedRegion === 'query'
  const resultsExpanded = expandedRegion === 'results'
  const contentBusy = running || !code.trim()
  const busy = contentBusy || activeConnectionState !== 'connected'
  const runEditor = (): void => {
    void runShell(selectedCode.current)
  }

  useEffect(() => {
    selectedCode.current = undefined
  }, [activeTabId])

  useEffect(() => {
    const rememberRegion = (event: Event): void => {
      lastShortcutRegion.current = shortcutRegionFromTarget(event.target) ?? 'query'
    }
    const onKey = (event: KeyboardEvent): void => {
      if (
        !isAppShortcutEnabled(keyboardShortcutsEnabled, disabledKeyboardShortcuts, 'contextualTabs') ||
        hasOpenShortcutLayer()
      )
        return
      const index = contextualTabDigitIndex(event, isMacPlatform())
      if (index == null) return

      const state = useAppStore.getState()
      const region = lastShortcutRegion.current
      if (region === 'result') {
        const resultTab = getActiveTab(state).results[index]
        if (!resultTab) return
        event.preventDefault()
        state.setActiveResultTab(resultTab.id)
        return
      }

      const queryTab = state.tabs[index]
      if (!queryTab) return
      event.preventDefault()
      state.setActiveTab(queryTab.id)
    }

    window.addEventListener('pointerdown', rememberRegion, true)
    window.addEventListener('focusin', rememberRegion, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', rememberRegion, true)
      window.removeEventListener('focusin', rememberRegion, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [disabledKeyboardShortcuts, keyboardShortcutsEnabled])

  return (
    <div className="work">
      <TabBar />
      <div className="shell-body">
        <main className={`shell-main${expandedRegion ? ` ${expandedRegion}-expanded` : ''}`}>
          <div className="work-header" data-shortcut-region="query">
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
                <Button variant="danger" disabled={stopping} onClick={() => void stopShell()}>
                  <LoaderCircle className="animate-spin" aria-hidden />
                  {t(stopping ? 'shell.stopping' : 'shell.stopTip')}
                </Button>
              ) : (
                <Button variant="primary" disabled={busy} onClick={runEditor}>
                  <Play aria-hidden /> {t('shell.runBtn')}
                </Button>
              )}
              <Tooltip content={t('shell.explainBtn')}>
                <button
                  className="work-icon-btn"
                  disabled={busy}
                  onClick={() => void runExplain()}
                  aria-label={t('shell.explainBtn')}
                >
                  <Activity size={15} />
                </button>
              </Tooltip>
              <Tooltip content={t('shell.saveQueryTip')}>
                <button
                  className="work-icon-btn"
                  disabled={contentBusy}
                  onClick={() => setShowSave(true)}
                  aria-label={t('shell.saveBtn')}
                >
                  <Save size={15} />
                </button>
              </Tooltip>
              <button
                className={`work-icon-btn${queryExpanded ? ' is-active' : ''}`}
                aria-label={t(queryExpanded ? 'shell.restoreQuery' : 'shell.expandQuery')}
                aria-pressed={queryExpanded}
                onClick={() => setExpandedRegion((current) => (current === 'query' ? null : 'query'))}
              >
                {queryExpanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
              </button>
              <button
                className="work-icon-btn context-toggle"
                onClick={() => setContextOpen((open) => !open)}
                aria-label={t(contextOpen ? 'context.close' : 'context.open')}
              >
                {contextOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
              </button>
            </div>
          </div>

          {/* Key the editor by tab id so each tab gets its own CodeMirror
              instance (isolated undo history / selection). */}
          <div className="editor-row" data-shortcut-region="query">
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
              saveBusy={contentBusy}
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

          <ResultPanel
            expanded={resultsExpanded}
            onExpandedChange={(expanded) => setExpandedRegion(expanded ? 'results' : null)}
          />
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
function TabBar(): React.JSX.Element {
  const { t } = useTranslation()
  const tabs = useAppStore((s) => s.tabs)
  const connections = useAppStore((s) => s.connections)
  const statuses = useAppStore((s) => s.statuses)
  const activeTabId = useAppStore((s) => s.activeTabId)
  const setActiveTab = useAppStore((s) => s.setActiveTab)
  const closeTab = useAppStore((s) => s.closeTab)
  const newTab = useAppStore((s) => s.newTab)
  const connect = useAppStore((s) => s.connect)
  const keyboardShortcutsEnabled = useAppStore((s) => s.settings.keyboardShortcutsEnabled)
  const disabledKeyboardShortcuts = useAppStore((s) => s.settings.disabledKeyboardShortcuts)
  const stripRef = useRef<HTMLDivElement>(null)
  const connectionTextColor = (connectionId: string | null): string | undefined => {
    const color = connections.find((conn) => conn.id === connectionId)?.color
    return color ? `color-mix(in srgb, ${color} 60%, var(--text-secondary))` : undefined
  }

  useEffect(() => {
    const strip = stripRef.current
    if (!strip) return
    const revealActive = (): void => {
      strip
        .querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(activeTabId)}"]`)
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
    revealActive()
    const observer = new ResizeObserver(revealActive)
    observer.observe(strip)
    return () => observer.disconnect()
  }, [activeTabId])

  // ⌘T / Ctrl+T opens a new query tab (reads the action via getState to keep
  // this listener stable). ⌘W is left alone — it's Electron's window close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (
        isAppShortcutEnabled(keyboardShortcutsEnabled, disabledKeyboardShortcuts, 'newQuery') &&
        !e.repeat &&
        !hasOpenShortcutLayer() &&
        isPrimaryShortcut(e, 't', isMacPlatform())
      ) {
        e.preventDefault()
        useAppStore.getState().newTab()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [disabledKeyboardShortcuts, keyboardShortcutsEnabled])

  return (
    <div className="tab-bar app-drag" data-shortcut-region="query">
      <Select
        value={activeTabId}
        onChange={setActiveTab}
        options={tabs.map((tab, index) => ({
          value: tab.id,
          label: (
            <span className="flex min-w-0 flex-1 items-center gap-3">
              <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                <span style={{ color: connectionTextColor(tab.connectionId) }}>{tabLabel(tab, index)}</span>
              </span>
              <small className="shrink-0 text-[11px] text-muted-foreground">{tab.activeDatabase}</small>
            </span>
          )
        }))}
        className="query-tab-picker"
        triggerContent={<ChevronDown size={15} aria-hidden />}
        popupClassName="w-[272px]"
        popupHeader={
          <div className="px-2 py-2 text-[11px] font-medium text-muted-foreground">
            {t('shell.tabListLabel')} · {tabs.length}
          </div>
        }
        aria-label={t('shell.tabListLabel')}
      />
      <div ref={stripRef} className="tab-strip">
        {tabs.map((tab, i) => {
          const connectionStatus = tab.connectionId ? statuses[tab.connectionId] : undefined
          const unavailable =
            !!tab.connectionId &&
            (connectionStatus === undefined ||
              connectionStatus.state === 'disconnected' ||
              connectionStatus.state === 'error')
          const reconnectLabel = connectionStatus?.error
            ? `${t('shell.reconnect')}: ${connectionStatus.error}`
            : t('shell.reconnect')
          return (
            <DocumentTab
              key={tab.id}
              active={tab.id === activeTabId}
              className="qtab"
              dataTabId={tab.id}
              label={<span style={{ color: connectionTextColor(tab.connectionId) }}>{tabLabel(tab, i)}</span>}
              closeLabel={t('shell.closeTab')}
              onSelect={() => setActiveTab(tab.id)}
              onClose={() => closeTab(tab.id)}
              statusAction={
                unavailable && tab.connectionId
                  ? {
                      label: reconnectLabel,
                      onClick: () => {
                        setActiveTab(tab.id)
                        void connect(tab.connectionId!)
                      }
                    }
                  : undefined
              }
              status={
                unavailable ? (
                  <CircleX className="qtab-disconnected" />
                ) : connectionStatus?.state === 'connecting' || tab.running ? (
                  <LoaderCircle className="qtab-spinner animate-spin" />
                ) : tab.runFailed ? (
                  <span className="qtab-error-dot" />
                ) : null
              }
            />
          )
        })}
        <button className="qtab-new" aria-label={t('shell.newTabLabel')} onClick={() => newTab()}>
          <Plus size={14} />
        </button>
      </div>
    </div>
  )
}
