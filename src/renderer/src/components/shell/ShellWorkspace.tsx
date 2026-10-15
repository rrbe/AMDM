import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import {
  Brush,
  ChevronDown,
  ChevronRight,
  FlaskConical,
  LoaderCircle,
  Maximize2,
  Minimize2,
  PanelRightClose,
  PanelRightOpen,
  Play,
  Plus,
  Save,
  Search,
  Unplug
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAppStore, getActiveTab } from '@renderer/store/useAppStore'
import { tabCollection, tabLabel } from '@renderer/lib/tabs'
import type { ShellEditorHandle } from './ShellEditor'
import { SaveQueryModal } from './SaveQueryModal'
import { Collapsible } from '@renderer/components/ui/Collapsible'
import { ContextPanel } from './ContextPanel'
import { ResultPanel } from '@renderer/components/results/ResultPanel'
import { ResizeHandle } from '@renderer/components/common/ResizeHandle'
import { Button } from '@renderer/components/common/Button'
import { ShortcutHint } from '@renderer/components/common/ShortcutHint'
import { ResultDataSize } from '@renderer/components/common/ResultDataSize'
import { DocumentTabStrip } from '@renderer/components/common/DocumentTabStrip'
import { DocumentTab } from '@renderer/components/common/DocumentTab'
import { useTabReorder } from '@renderer/lib/useTabReorder'
import { formatRelativeQueryTime } from '@renderer/lib/queryTime'
import { Tooltip } from '@renderer/components/ui/Tooltip'
import { ContextMenu } from '@renderer/components/ContextMenu'
import {
  dataTabDigitIndex,
  dataTabDirection,
  hasOpenShortcutLayer,
  isAppShortcutEnabled,
  isMacPlatform,
  isPrimaryShortcut,
  queryTabDigitIndex,
  queryTabDirection,
  tabShortcutLabel,
  type ShortcutHintModifier
} from '@renderer/lib/keyboardShortcuts'

const ShellEditor = lazy(async () => ({ default: (await import('./ShellEditor')).ShellEditor }))

/**
 * The main work area: a tab strip, header (active connection + database +
 * Run), the lazy CodeMirror editor, and the result panel below. Each tab owns
 * its own code/result/db/run state (see the store's `tabs`).
 */
export function ShellWorkspace({ shortcutHints, onSearch, onQuickSearch }: {
  shortcutHints: ShortcutHintModifier | null
  onSearch: () => void
  onQuickSearch: () => void
}): React.JSX.Element {
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
  const contextPanelWidth = useAppStore((s) => s.settings.contextPanelWidth)
  const contextOpen = useAppStore((s) => s.settings.contextPanelOpen)
  const keyboardShortcutsEnabled = useAppStore((s) => s.settings.keyboardShortcutsEnabled)
  const disabledKeyboardShortcuts = useAppStore((s) => s.settings.disabledKeyboardShortcuts)
  const updateSettings = useAppStore((s) => s.updateSettings)

  const primaryKey = isMacPlatform() ? '⌘' : 'Ctrl+'

  const [showSave, setShowSave] = useState(false)
  const [expandedRegion, setExpandedRegion] = useState<'query' | 'results' | null>(null)
  const editorRef = useRef<ShellEditorHandle>(null)
  const shellBodyRef = useRef<HTMLDivElement>(null)

  const conn = connections.find((c) => c.id === activeConnectionId)
  const targetCollection = useAppStore((s) => tabCollection(getActiveTab(s)))
  const queryExpanded = expandedRegion === 'query'
  const resultsExpanded = expandedRegion === 'results'
  const contentBusy = running || !code.trim()
  const busy = contentBusy || activeConnectionState !== 'connected'
  const runEditor = (): void => {
    void runShell(editorRef.current?.getSelectedCode())
  }

  useEffect(() => {
    const tabShortcutsEnabled = isAppShortcutEnabled(
      keyboardShortcutsEnabled,
      disabledKeyboardShortcuts,
      'contextualTabs'
    )
    if (!tabShortcutsEnabled) return

    const isMac = isMacPlatform()
    const onKey = (event: KeyboardEvent): void => {
      if (hasOpenShortcutLayer()) return
      const state = useAppStore.getState()
      const queryIndex = queryTabDigitIndex(event, isMac)
      const dataIndex = dataTabDigitIndex(event, isMac)
      const queryDirection = queryTabDirection(event)
      const dataDirection = dataTabDirection(event, isMac)
      if (queryIndex == null && dataIndex == null && queryDirection == null && dataDirection == null) return
      const resultShortcut = dataIndex != null || dataDirection != null
      const tabs = resultShortcut ? getActiveTab(state).results : state.tabs
      const activeId = resultShortcut ? getActiveTab(state).activeResultId : state.activeTabId
      if (!tabs.length) return
      const digit = dataIndex ?? queryIndex
      const direction = dataDirection ?? queryDirection
      const index =
        digit === 8
          ? tabs.length - 1
          : (digit ?? (tabs.findIndex((tab) => tab.id === activeId) + direction! + tabs.length) % tabs.length)
      const tab = tabs[index]
      if (!tab) return
      event.preventDefault()
      event.stopPropagation()
      if (resultShortcut) state.setActiveResultTab(tab.id)
      else state.setActiveTab(tab.id)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [disabledKeyboardShortcuts, keyboardShortcutsEnabled])

  return (
    <div className="work">
      <TabBar
        onSearch={onSearch}
        onQuickSearch={onQuickSearch}
        showShortcutHints={shortcutHints === 'query-tabs'}
        contextOpen={contextOpen}
        onContextToggle={() => void updateSettings({ contextPanelOpen: !contextOpen })}
      />
      <div className="shell-body" ref={shellBodyRef}>
        <main className={`shell-main${expandedRegion ? ` ${expandedRegion}-expanded` : ''}`}>
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
                <Button variant="danger" disabled={stopping} onClick={() => void stopShell()}>
                  <LoaderCircle className="animate-spin" aria-hidden />
                  {t(stopping ? 'shell.stopping' : 'shell.stopTip')}
                </Button>
              ) : (
                <Tooltip content={`${t('shell.runTip')} · ${isMacPlatform() ? '⌘Enter' : 'Ctrl+Enter'}`}>
                  <Button
                    variant="primary"
                    aria-disabled={busy}
                    onClick={() => {
                      if (!busy) runEditor()
                    }}
                  >
                    <ShortcutHint shortcut={busy ? undefined : `${primaryKey}↵`}>
                      <Play aria-hidden />
                    </ShortcutHint>{' '}
                    {t('shell.runBtn')}
                  </Button>
                </Tooltip>
              )}
              <Tooltip content={`${t('shell.explainBtn')} · ${isMacPlatform() ? '⌘⇧E' : 'Ctrl+Shift+E'}`}>
                <button
                  className="work-icon-btn"
                  aria-disabled={busy}
                  onClick={() => {
                    if (!busy) void runExplain()
                  }}
                  aria-label={t('shell.explainBtn')}
                >
                  <ShortcutHint shortcut={busy ? undefined : `${primaryKey}⇧E`}>
                    <FlaskConical size={15} />
                  </ShortcutHint>
                </button>
              </Tooltip>
              <Tooltip content={`${t('shell.menu.format')} · ${isMacPlatform() ? '⌘⇧F' : 'Ctrl+Shift+F'}`}>
                <button
                  className="work-icon-btn"
                  aria-disabled={!code.trim()}
                  onClick={() => void formatCode()}
                  aria-label={t('shell.menu.format')}
                >
                  <ShortcutHint shortcut={!code.trim() ? undefined : `${primaryKey}⇧F`}>
                    <Brush size={15} aria-hidden />
                  </ShortcutHint>
                </button>
              </Tooltip>
              <Tooltip content={`${t('shell.saveQueryTip')} · ${isMacPlatform() ? '⌘S' : 'Ctrl+S'}`}>
                <button
                  className="work-icon-btn"
                  aria-disabled={contentBusy}
                  onClick={() => {
                    if (!contentBusy) setShowSave(true)
                  }}
                  aria-label={t('shell.saveBtn')}
                >
                  <ShortcutHint shortcut={contentBusy ? undefined : `${primaryKey}S`}>
                    <Save size={15} />
                  </ShortcutHint>
                </button>
              </Tooltip>
              <Tooltip content={t(queryExpanded ? 'shell.restoreQuery' : 'shell.expandQuery')}>
                <button
                  className={`work-icon-btn${queryExpanded ? ' is-active' : ''}`}
                  aria-label={t(queryExpanded ? 'shell.restoreQuery' : 'shell.expandQuery')}
                  aria-pressed={queryExpanded}
                  onClick={() => setExpandedRegion((current) => (current === 'query' ? null : 'query'))}
                >
                  {queryExpanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                </button>
              </Tooltip>
            </div>
          </div>

          {/* Key the editor by tab id so each tab gets its own CodeMirror
              instance (isolated undo history / selection). */}
          <div className="editor-row">
            <Suspense fallback={
              <div className="editor-wrap">
                <div className="editor-loading">{t('shell.loadingEditor')}</div>
              </div>
            }>
              <ShellEditor
                ref={editorRef}
                key={activeTabId}
                value={code}
                onChange={setCode}
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
            </Suspense>
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
            showViewShortcutHints={shortcutHints === 'primary'}
            showTabShortcutHints={shortcutHints === 'result-tabs'}
          />
        </main>

        {contextOpen && (
          <ResizeHandle
            axis="x"
            direction={-1}
            cssVar="--context-panel-width"
            className="resize-handle--col context-resize-handle"
            value={contextPanelWidth}
            min={240}
            getMax={() => {
              const width = shellBodyRef.current!.clientWidth
              // The divider occupies 1px after its overlapping margins.
              return Math.max(0, Math.min(width / 2, width - 481))
            }}
            onCommit={(px) => void updateSettings({ contextPanelWidth: px })}
            ariaLabel={t('context.resize')}
          />
        )}
        <Collapsible open={contextOpen} axis="horizontal" className="context-disclosure">
          <aside className="context-rail">
            <ContextPanel />
          </aside>
        </Collapsible>
      </div>

      {showSave && <SaveQueryModal onClose={() => setShowSave(false)} />}
    </div>
  )
}

/**
 * The query-tab strip: one chip per open tab (label derived from its code), a
 * fixed status slot (spinner / failure dot), a close ✕, and a trailing "+".
 */
function TabBar({
  onSearch,
  onQuickSearch,
  showShortcutHints,
  contextOpen,
  onContextToggle
}: {
  onSearch: () => void
  onQuickSearch: () => void
  showShortcutHints: boolean
  contextOpen: boolean
  onContextToggle: () => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const tabs = useAppStore((s) => s.tabs)
  const connections = useAppStore((s) => s.connections)
  const statuses = useAppStore((s) => s.statuses)
  const activeTabId = useAppStore((s) => s.activeTabId)
  const setActiveTab = useAppStore((s) => s.setActiveTab)
  const closeTab = useAppStore((s) => s.closeTab)
  const closeTabs = useAppStore((s) => s.closeTabs)
  const newTab = useAppStore((s) => s.newTab)
  const duplicateTab = useAppStore((s) => s.duplicateTab)
  const connect = useAppStore((s) => s.connect)
  const keyboardShortcutsEnabled = useAppStore((s) => s.settings.keyboardShortcutsEnabled)
  const disabledKeyboardShortcuts = useAppStore((s) => s.settings.disabledKeyboardShortcuts)
  const quickSearchShortcut = isAppShortcutEnabled(keyboardShortcutsEnabled, disabledKeyboardShortcuts, 'quickSearch')
    ? `${isMacPlatform() ? '⌘' : 'Ctrl+'}K`
    : undefined
  const tabShortcutsEnabled = isAppShortcutEnabled(
    keyboardShortcutsEnabled,
    disabledKeyboardShortcuts,
    'contextualTabs'
  )
  const tabShortcut = (index: number): string | undefined =>
    tabShortcutsEnabled ? tabShortcutLabel(index, tabs.length, false, isMacPlatform()) : undefined
  const stripRef = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; tabId: string } | null>(null)
  const moveQueryTab = useAppStore((s) => s.moveQueryTab)
  useTabReorder(stripRef, tabs, setActiveTab, moveQueryTab)
  const connectionTextColor = (connectionId: string | null): string | undefined => {
    const color = connections.find((conn) => conn.id === connectionId)?.color
    return color ? `color-mix(in srgb, ${color} 60%, var(--text-secondary))` : undefined
  }

  // Cmd/Ctrl+W closes the query first; an already empty workspace closes the window.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isPrimaryShortcut(e, 'w', isMacPlatform())) {
        e.preventDefault()
        if (e.repeat || hasOpenShortcutLayer()) return
        const state = useAppStore.getState()
        const tab = getActiveTab(state)
        if (state.tabs.length === 1 && !tab.code.trim() && tab.results.length === 0 && !tab.running) {
          window.close()
        } else {
          state.closeTab(tab.id)
        }
        return
      }
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
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [disabledKeyboardShortcuts, keyboardShortcutsEnabled])

  return (
    <div className="tab-bar app-drag">
      <button
        type="button"
        className="query-tab-picker inline-flex items-center rounded-[var(--radius-control)] border-0 outline-none focus-visible:shadow-[0_0_0_3px_var(--focus-soft)]"
        onClick={onSearch}
        aria-label={t('shell.tabSearchLabel')}
        aria-haspopup="dialog"
      >
        <ChevronDown size={15} aria-hidden />
      </button>
      <DocumentTabStrip stripRef={stripRef} count={tabs.length} activeId={activeTabId} kind="query">
        {tabs.map((tab, i) => {
          const connectionStatus = tab.connectionId ? statuses[tab.connectionId] : undefined
          const connectionName = connections.find((connection) => connection.id === tab.connectionId)?.name
          const collection = tabCollection(tab)
          const lastExecutedAt = tab.results.reduce((latest, result) => Math.max(latest, result.executedAt), 0)
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
              contextMenuOpen={menu?.tabId === tab.id}
              className="qtab"
              dataTabId={tab.id}
              label={<span style={{ color: connectionTextColor(tab.connectionId) }}>{tabLabel(tab, i)}</span>}
              tooltip={() => (
                <dl
                  data-query-tab-tooltip=""
                  className="m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1"
                >
                  <dt className="text-primary-foreground/65">{t('context.connection')}</dt>
                  <dd className="m-0 min-w-0 break-words">{connectionName ?? tab.connectionId ?? '—'}</dd>
                  <dt className="text-primary-foreground/65">{t('context.database')}</dt>
                  <dd className="m-0 min-w-0 break-words">{tab.activeDatabase || '—'}</dd>
                  <dt className="text-primary-foreground/65">{t('context.collection')}</dt>
                  <dd className="m-0 min-w-0 break-words">{collection ?? '—'}</dd>
                  <dt className="text-primary-foreground/65">{t('context.totalResultDataSize')}</dt>
                  <dd className="m-0"><ResultDataSize results={tab.results} /></dd>
                  {lastExecutedAt > 0 && (
                    <>
                      <dt className="text-primary-foreground/65">{t('context.queryTime')}</dt>
                      <dd className="m-0" data-query-tab-time="">
                        {formatRelativeQueryTime(lastExecutedAt, i18n.language)}
                      </dd>
                    </>
                  )}
                </dl>
              )}
              tooltipVariant="text"
              closeLabel={t('shell.closeTab')}
              onSelect={() => setActiveTab(tab.id)}
              onClose={() => closeTab(tab.id)}
              onContextMenu={(event) => {
                event.preventDefault()
                setMenu({ x: event.clientX, y: event.clientY, tabId: tab.id })
              }}
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
                  <Unplug className="qtab-disconnected" />
                ) : connectionStatus?.state === 'connecting' || tab.running ? (
                  <LoaderCircle className="qtab-spinner animate-spin" />
                ) : tab.runFailed ? (
                  <span className="qtab-error-dot" />
                ) : null
              }
              shortcut={tabShortcut(i)}
              showShortcutHint={showShortcutHints}
            />
          )
        })}
        <button className="qtab-new" aria-label={t('shell.newTabLabel')} onClick={() => newTab()}>
          <ShortcutHint
            shortcut={
              isAppShortcutEnabled(keyboardShortcutsEnabled, disabledKeyboardShortcuts, 'newQuery')
                ? `${isMacPlatform() ? '⌘' : 'Ctrl+'}T`
                : undefined
            }
          >
            <Plus size={14} />
          </ShortcutHint>
        </button>
      </DocumentTabStrip>
      <Tooltip content={t('quickSearch.title')}>
        <button
          type="button"
          className="side-head-action side-search-toggle gap-1.5 self-center mb-1"
          aria-label={t('quickSearch.title')}
          aria-haspopup="dialog"
          onClick={onQuickSearch}
        >
          <Search size={16} aria-hidden />
          {quickSearchShortcut && <span className="text-[11px] leading-none" aria-hidden>{quickSearchShortcut}</span>}
        </button>
      </Tooltip>
      <button
        className="side-head-action context-toggle"
        onClick={onContextToggle}
        aria-label={t(contextOpen ? 'context.close' : 'context.open')}
        aria-expanded={contextOpen}
      >
        {contextOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
      </button>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: t('shell.newTabMenu'), onClick: () => newTab(menu.tabId) },
            { label: t('shell.duplicateTab'), onClick: () => duplicateTab(menu.tabId) },
            'separator',
            { label: t('shell.closeTab'), onClick: () => closeTab(menu.tabId) },
            {
              label: t('shell.closeConnectionTabs'),
              disabled: !tabs.find((tab) => tab.id === menu.tabId)?.connectionId,
              onClick: () => {
                const connectionId = tabs.find((tab) => tab.id === menu.tabId)?.connectionId
                closeTabs(tabs.filter((tab) => tab.connectionId === connectionId).map((tab) => tab.id))
              }
            },
            {
              label: t('shell.closeTabsToRight'),
              disabled: tabs.findIndex((tab) => tab.id === menu.tabId) === tabs.length - 1,
              onClick: () =>
                closeTabs(tabs.slice(tabs.findIndex((tab) => tab.id === menu.tabId) + 1).map((tab) => tab.id))
            },
            { label: t('shell.closeAllTabs'), onClick: () => closeTabs(tabs.map((tab) => tab.id)) }
          ]}
        />
      )}
    </div>
  )
}
