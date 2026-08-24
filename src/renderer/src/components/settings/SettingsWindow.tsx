import { useEffect, useState } from 'react'
import { Code2, Database, FolderOutput, Keyboard, Palette, RefreshCw, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  DEFAULT_SETTINGS,
  HISTORY_LIMITS,
  QUERY_LIMITS,
  QUERY_TIMEOUTS_MS,
  type CollectionSort,
  type KeyboardShortcutId,
  type Language,
  type ThemeMode
} from '@shared/types'
import { setLanguage } from '@renderer/i18n'
import { matchesSettingsSearch } from '@renderer/lib/settingsSearch'
import { useAppStore } from '@renderer/store/useAppStore'
import { Button } from '@renderer/components/common/Button'
import { Toaster } from '@renderer/components/common/Toaster'
import { Field } from '@renderer/components/ui/Field'
import { Input } from '@renderer/components/ui/Input'
import { Select } from '@renderer/components/ui/Select'
import { NumberField } from '@renderer/components/ui/NumberField'
import { Checkbox } from '@renderer/components/ui/Checkbox'
import { EditorColorSchemeSettings } from '@renderer/components/settings/EditorColorSchemeSettings'
import { isMacPlatform } from '@renderer/lib/keyboardShortcuts'
import { cn } from '@renderer/lib/utils'

type SettingsSection = 'appearance' | 'updates' | 'catalog' | 'export' | 'query' | 'editor' | 'shortcuts'

interface UpdateAvailableDotProps {
  version: string
  className?: string
}

export function UpdateAvailableDot({ version, className }: UpdateAvailableDotProps): React.JSX.Element {
  const { t } = useTranslation()
  const label = t('updates.newVersion', { version })

  return (
    <span
      role="status"
      aria-label={label}
      title={label}
      className={cn('inline-block size-2 shrink-0 rounded-full bg-destructive', className)}
    />
  )
}

export function SettingsWindow(): React.JSX.Element {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const updateState = useAppStore((s) => s.updateState)
  const checkForUpdates = useAppStore((s) => s.checkForUpdates)
  const loadUpdateState = useAppStore((s) => s.loadUpdateState)
  const setAutomaticUpdateChecks = useAppStore((s) => s.setAutomaticUpdateChecks)
  const showAvailableUpdate = useAppStore((s) => s.showAvailableUpdate)
  const loadSettings = useAppStore((s) => s.loadSettings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const chooseExportDirectory = useAppStore((s) => s.chooseExportDirectory)
  const [activeSection, setActiveSection] = useState<SettingsSection>('appearance')
  const [searchQuery, setSearchQuery] = useState('')
  const [checking, setChecking] = useState(false)
  const [choosingExportDirectory, setChoosingExportDirectory] = useState(false)
  const primaryKey = isMacPlatform() ? '⌘' : 'Ctrl'

  const sections = [
    {
      id: 'appearance',
      label: t('settings.sectionAppearance'),
      icon: Palette,
      keywords: [
        t('settings.sectionAppearance'),
        t('settings.language'),
        t('settings.languageSystem'),
        t('settings.theme'),
        t('settings.themeSystem'),
        t('settings.themeLight'),
        t('settings.themeDark')
      ]
    },
    {
      id: 'updates',
      label: t('settings.sectionUpdates'),
      icon: RefreshCw,
      keywords: [
        t('settings.sectionUpdates'),
        t('settings.automaticUpdateChecks'),
        t('settings.checkForUpdates')
      ]
    },
    {
      id: 'catalog',
      label: t('settings.sectionCatalog'),
      icon: Database,
      keywords: [
        t('settings.sectionCatalog'),
        t('settings.collectionSort'),
        t('settings.sortNatural'),
        t('settings.sortAlpha')
      ]
    },
    {
      id: 'query',
      label: t('settings.sectionQuery'),
      icon: Search,
      keywords: [
        t('settings.sectionQuery'),
        t('settings.queryLimit'),
        t('settings.queryLimitHint'),
        t('settings.queryTimeout'),
        t('settings.queryTimeoutHint'),
        t('settings.historyLimit'),
        t('settings.historyLimitHint')
      ]
    },
    {
      id: 'export',
      label: t('settings.sectionExport'),
      icon: FolderOutput,
      keywords: [
        t('settings.sectionExport'),
        t('settings.defaultExportDirectory'),
        t('settings.defaultExportDirectoryHint'),
        t('settings.chooseExportDirectory')
      ]
    },
    {
      id: 'editor',
      label: t('settings.sectionEditor'),
      icon: Code2,
      keywords: [
        t('settings.sectionEditor'),
        t('settings.editorFontSize'),
        t('settings.dataFontSize'),
        t('settings.editorWordWrap'),
        t('settings.editorTabSize'),
        t('settings.resetEditorSettings'),
        t('settings.editorColors.title'),
        t('settings.editorColors.scheme'),
        t('settings.editorColors.keyword')
      ]
    },
    {
      id: 'shortcuts',
      label: t('settings.sectionShortcuts'),
      icon: Keyboard,
      keywords: [
        t('settings.sectionShortcuts'),
        t('settings.keyboardShortcutsEnabled'),
        t('settings.shortcutNewConnection'),
        t('settings.shortcutNewQuery'),
        t('settings.shortcutContextualTabs'),
        t('settings.shortcutResultView'),
        t('settings.shortcutOpenSettings'),
        t('settings.shortcutClear'),
        t('settings.shortcutRestore')
      ]
    }
  ] as const
  const visibleSections = sections.filter((section) => matchesSettingsSearch(section.keywords, searchQuery))
  const displayedSection = visibleSections.find((section) => section.id === activeSection) ?? visibleSections[0]
  const displayedSectionId = displayedSection?.id

  useEffect(() => {
    void loadSettings()
    void loadUpdateState()
  }, [loadSettings, loadUpdateState])

  useEffect(() => {
    setLanguage(settings.language)
  }, [settings.language])

  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      const resolved = settings.theme === 'system' ? (mql.matches ? 'dark' : 'light') : settings.theme
      document.documentElement.setAttribute('data-theme', resolved)
    }
    apply()
    if (settings.theme !== 'system') return
    mql.addEventListener('change', apply)
    return () => mql.removeEventListener('change', apply)
  }, [settings.theme])

  useEffect(() => {
    document.title = t('settings.title')
  }, [t])

  const runUpdateCheck = async (): Promise<void> => {
    setChecking(true)
    try {
      if (updateState.availableVersion) await showAvailableUpdate()
      else await checkForUpdates()
    } finally {
      setChecking(false)
    }
  }

  const setShortcutEnabled = (id: KeyboardShortcutId, enabled: boolean): void => {
    const disabledKeyboardShortcuts = enabled
      ? settings.disabledKeyboardShortcuts.filter((shortcut) => shortcut !== id)
      : [...new Set([...settings.disabledKeyboardShortcuts, id])]
    void updateSettings({ disabledKeyboardShortcuts })
  }

  const selectDefaultExportDirectory = async (): Promise<void> => {
    if (choosingExportDirectory) return
    setChoosingExportDirectory(true)
    try {
      const selection = await chooseExportDirectory()
      if (selection) await updateSettings({ defaultExportDirectory: selection.path })
    } finally {
      setChoosingExportDirectory(false)
    }
  }

  return (
    <div className="grid h-screen grid-cols-[210px_minmax(0,1fr)] overflow-hidden bg-card text-foreground">
      <nav
        className="app-drag flex flex-col gap-1 border-r border-border bg-secondary px-3 pb-4 pt-[52px]"
        aria-label={t('settings.title')}
      >
        <label className="relative mb-3 block">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={t('settings.searchPlaceholder')}
            aria-label={t('settings.searchPlaceholder')}
            className="h-9 w-full rounded-md border border-border bg-card py-1 pl-9 pr-3 text-[13px] text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-[var(--fg-3)] focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--accent-soft)]"
          />
        </label>

        {visibleSections.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className={`flex items-center gap-2.5 rounded-md border-0 px-3 py-2 text-left text-[13px] font-medium outline-none transition-colors focus-visible:shadow-[0_0_0_3px_var(--accent-soft)] ${
              displayedSectionId === id
                ? 'bg-[var(--bg-sel)] text-foreground'
                : 'bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground'
            }`}
            aria-current={displayedSectionId === id ? 'page' : undefined}
            onClick={() => setActiveSection(id)}
          >
            <Icon size={16} aria-hidden />
            <span>{label}</span>
            {id === 'updates' && updateState.availableVersion ? (
              <UpdateAvailableDot version={updateState.availableVersion} className="ml-auto" />
            ) : null}
          </button>
        ))}
      </nav>

      <main className="relative overflow-y-auto bg-card px-8 pb-8 pt-[52px]">
        <div className="app-drag absolute inset-x-0 top-0 h-10" />
        <div className="max-w-[680px]">
          <h1 className="mb-7 text-[22px] font-semibold tracking-[-0.01em]">
            {displayedSection?.label ?? t('settings.searchNoResults')}
          </h1>

          {displayedSectionId === 'appearance' && (
            <>
              <Field label={t('settings.language')}>
                <Select<Language>
                  value={settings.language}
                  onChange={(language) => void updateSettings({ language })}
                  options={[
                    { label: t('settings.languageSystem'), value: 'system' },
                    { label: 'English', value: 'en' },
                    { label: '简体中文', value: 'zh-CN' },
                    { label: '繁體中文', value: 'zh-TW' }
                  ]}
                />
              </Field>

              <Field label={t('settings.theme')}>
                <Select<ThemeMode>
                  value={settings.theme}
                  onChange={(theme) => void updateSettings({ theme })}
                  options={[
                    { label: t('settings.themeSystem'), value: 'system' },
                    { label: t('settings.themeLight'), value: 'light' },
                    { label: t('settings.themeDark'), value: 'dark' }
                  ]}
                />
              </Field>
            </>
          )}

          {displayedSectionId === 'updates' && (
            <>
              <div className="mb-3">
                <Checkbox
                  checked={updateState.automaticallyChecksForUpdates}
                  disabled={!updateState.available}
                  onCheckedChange={(enabled) => void setAutomaticUpdateChecks(enabled)}
                  label={t('settings.automaticUpdateChecks')}
                />
              </div>
              <Field label={t('settings.checkForUpdates')}>
                <div className="relative w-fit">
                  <Button
                    type="button"
                    busy={checking}
                    disabled={!updateState.available}
                    onClick={() => void runUpdateCheck()}
                  >
                    {checking ? t('settings.checkingForUpdates') : t('settings.checkForUpdates')}
                  </Button>
                  {updateState.availableVersion ? (
                    <UpdateAvailableDot
                      version={updateState.availableVersion}
                      className="pointer-events-none absolute -right-1 -top-1"
                    />
                  ) : null}
                </div>
              </Field>
            </>
          )}

          {displayedSectionId === 'catalog' && (
            <Field label={t('settings.collectionSort')}>
              <Select<CollectionSort>
                value={settings.collectionSort}
                onChange={(collectionSort) => void updateSettings({ collectionSort })}
                options={[
                  { label: t('settings.sortNatural'), value: 'natural' },
                  { label: t('settings.sortAlpha'), value: 'alpha' }
                ]}
              />
            </Field>
          )}

          {displayedSectionId === 'export' && (
            <Field label={t('settings.defaultExportDirectory')} hint={t('settings.defaultExportDirectoryHint')}>
              <div className="flex min-w-0 items-center gap-2">
                <Input
                  className="min-w-0 flex-1 font-mono text-xs"
                  value={settings.defaultExportDirectory}
                  title={settings.defaultExportDirectory}
                  readOnly
                />
                <Button
                  type="button"
                  className="h-[38px] shrink-0"
                  busy={choosingExportDirectory}
                  onClick={() => void selectDefaultExportDirectory()}
                >
                  {t('settings.chooseExportDirectory')}
                </Button>
              </div>
            </Field>
          )}

          {displayedSectionId === 'query' && (
            <>
              <Field label={t('settings.queryLimit')} hint={t('settings.queryLimitHint')}>
                <Select<number>
                  value={settings.queryLimit}
                  onChange={(queryLimit) => void updateSettings({ queryLimit })}
                  options={QUERY_LIMITS.map((value) => ({ label: String(value), value }))}
                  aria-label={t('settings.queryLimit')}
                />
              </Field>
              <Field label={t('settings.queryTimeout')} hint={t('settings.queryTimeoutHint')}>
                <Select<number>
                  value={settings.queryTimeoutMS}
                  onChange={(queryTimeoutMS) => void updateSettings({ queryTimeoutMS })}
                  options={QUERY_TIMEOUTS_MS.map((value) => ({
                    label:
                      value === 0
                        ? t('settings.queryTimeoutOff')
                        : t('settings.queryTimeoutSeconds', { seconds: value / 1000 }),
                    value
                  }))}
                  aria-label={t('settings.queryTimeout')}
                />
              </Field>
              <Field label={t('settings.historyLimit')} hint={t('settings.historyLimitHint')}>
                <Select<number>
                  value={settings.historyLimit}
                  onChange={(historyLimit) => void updateSettings({ historyLimit })}
                  options={HISTORY_LIMITS.map((value) => ({ label: String(value), value }))}
                  aria-label={t('settings.historyLimit')}
                />
              </Field>
            </>
          )}

          {displayedSectionId === 'editor' && (
            <>
              <div className="form-grid">
                <Field label={t('settings.editorFontSize')}>
                  <NumberField
                    min={9}
                    max={28}
                    value={settings.editorFontSize}
                    onChange={(n) => {
                      if (n != null) void updateSettings({ editorFontSize: n })
                    }}
                    aria-label={t('settings.editorFontSize')}
                  />
                </Field>
                <Field label={t('settings.dataFontSize')}>
                  <NumberField
                    min={9}
                    max={28}
                    value={settings.dataFontSize}
                    onChange={(n) => {
                      if (n != null) void updateSettings({ dataFontSize: n })
                    }}
                    aria-label={t('settings.dataFontSize')}
                  />
                </Field>
                <Field label={t('settings.editorTabSize')}>
                  <Select<number>
                    value={settings.editorTabSize}
                    onChange={(editorTabSize) => void updateSettings({ editorTabSize })}
                    options={[
                      { label: '2', value: 2 },
                      { label: '4', value: 4 }
                    ]}
                  />
                </Field>
              </div>
              <Checkbox
                checked={settings.editorWordWrap}
                onCheckedChange={(editorWordWrap) => void updateSettings({ editorWordWrap })}
                label={t('settings.editorWordWrap')}
              />
              <div className="mb-6 mt-3">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={
                    settings.editorFontSize === DEFAULT_SETTINGS.editorFontSize &&
                    settings.dataFontSize === DEFAULT_SETTINGS.dataFontSize &&
                    settings.editorTabSize === DEFAULT_SETTINGS.editorTabSize &&
                    settings.editorWordWrap === DEFAULT_SETTINGS.editorWordWrap
                  }
                  onClick={() =>
                    void updateSettings({
                      editorFontSize: DEFAULT_SETTINGS.editorFontSize,
                      dataFontSize: DEFAULT_SETTINGS.dataFontSize,
                      editorTabSize: DEFAULT_SETTINGS.editorTabSize,
                      editorWordWrap: DEFAULT_SETTINGS.editorWordWrap
                    })
                  }
                >
                  {t('settings.resetEditorSettings')}
                </Button>
              </div>
              <EditorColorSchemeSettings />
            </>
          )}

          {displayedSectionId === 'shortcuts' && (
            <>
              <div className="mb-6 rounded-lg border border-border bg-secondary/45 p-4">
                <Checkbox
                  checked={settings.keyboardShortcutsEnabled}
                  onCheckedChange={(keyboardShortcutsEnabled) =>
                    void updateSettings({ keyboardShortcutsEnabled })
                  }
                  label={t('settings.keyboardShortcutsEnabled')}
                />
                <p className="mb-0 ml-[23px] mt-2 text-[12px] leading-5 text-muted-foreground">
                  {t('settings.keyboardShortcutsHint')}
                </p>
              </div>

              <div className="overflow-hidden rounded-lg border border-border">
                <ShortcutRow
                  label={t('settings.shortcutNewConnection')}
                  keys={`${primaryKey} N`}
                  enabled={!settings.disabledKeyboardShortcuts.includes('newConnection')}
                  onEnabledChange={(enabled) => setShortcutEnabled('newConnection', enabled)}
                />
                <ShortcutRow
                  label={t('settings.shortcutNewQuery')}
                  keys={`${primaryKey} T`}
                  enabled={!settings.disabledKeyboardShortcuts.includes('newQuery')}
                  onEnabledChange={(enabled) => setShortcutEnabled('newQuery', enabled)}
                />
                {isMacPlatform() && (
                  <ShortcutRow
                    label={t('settings.shortcutContextualTabs')}
                    keys="⌃ 1–9"
                    enabled={!settings.disabledKeyboardShortcuts.includes('contextualTabs')}
                    onEnabledChange={(enabled) => setShortcutEnabled('contextualTabs', enabled)}
                  />
                )}
                <ShortcutRow
                  label={t('settings.shortcutResultView')}
                  keys={`${primaryKey} 1–4`}
                  enabled={!settings.disabledKeyboardShortcuts.includes('resultView')}
                  onEnabledChange={(enabled) => setShortcutEnabled('resultView', enabled)}
                />
                <ShortcutRow
                  label={t('settings.shortcutOpenSettings')}
                  keys={`${primaryKey} ,`}
                  enabled={!settings.disabledKeyboardShortcuts.includes('openSettings')}
                  onEnabledChange={(enabled) => setShortcutEnabled('openSettings', enabled)}
                />
              </div>
            </>
          )}
        </div>
      </main>
      <Toaster />
    </div>
  )
}

function ShortcutRow({
  label,
  keys,
  enabled,
  onEnabledChange
}: {
  label: string
  keys: string
  enabled: boolean
  onEnabledChange: (enabled: boolean) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-12 items-center justify-between gap-6 border-b border-border px-4 py-2.5 last:border-b-0">
      <span className={enabled ? 'text-[13px] text-foreground/90' : 'text-[13px] text-muted-foreground'}>
        {label}
      </span>
      <div className="flex shrink-0 items-center gap-2">
        {enabled ? (
          <kbd className="rounded-md border border-[var(--separator-strong)] bg-[var(--surface-control)] px-2 py-1 font-mono text-[12px] text-muted-foreground shadow-[0_1px_0_var(--separator-strong)]">
            {keys}
          </kbd>
        ) : (
          <span className="px-2 py-1 text-[12px] text-muted-foreground">{t('settings.shortcutUnassigned')}</span>
        )}
        <button
          type="button"
          className="rounded-md border-0 bg-transparent px-2 py-1 text-[12px] text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:shadow-[0_0_0_3px_var(--focus-soft)]"
          onClick={() => onEnabledChange(!enabled)}
          aria-label={t(enabled ? 'settings.shortcutClearLabel' : 'settings.shortcutRestoreLabel', { label })}
        >
          {t(enabled ? 'settings.shortcutClear' : 'settings.shortcutRestore')}
        </button>
      </div>
    </div>
  )
}
