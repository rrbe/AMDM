import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { PINE_COLOR_SCHEME_ID, type EditorColorPalette, type EditorColorScheme } from '@shared/types'
import { Button } from '@renderer/components/common/Button'
import { Modal } from '@renderer/components/common/Modal'
import { Field } from '@renderer/components/ui/Field'
import { Input } from '@renderer/components/ui/Input'
import { Select } from '@renderer/components/ui/Select'
import { Tabs } from '@renderer/components/ui/Tabs'
import {
  EDITOR_PALETTE_PREVIEW_CHANNEL,
  PINE_EDITOR_COLOR_SCHEME,
  editorColorSchemeNameError,
  editorColorSchemesEqual,
  normalizeEditorColorSchemes,
  resolveEditorColorScheme,
  type EditorColorSchemeNameError,
  type EditorPalettePreviewMessage
} from '@renderer/lib/editorColorScheme'
import { randomUuid } from '@renderer/lib/randomUuid'
import { useIsDark } from '@renderer/lib/useIsDark'
import { useAppStore } from '@renderer/store/useAppStore'

type PaletteMode = 'light' | 'dark'
type ColorKey = keyof EditorColorPalette

const NEW_COLOR_SCHEME_ID = '__new_color_scheme__'

const COLOR_FIELDS: ReadonlyArray<{ key: ColorKey; label: string }> = [
  { key: 'background', label: 'background' },
  { key: 'foreground', label: 'foreground' },
  { key: 'keyword', label: 'keyword' },
  { key: 'string', label: 'string' },
  { key: 'number', label: 'number' },
  { key: 'type', label: 'type' },
  { key: 'comment', label: 'comment' }
]

function cloneScheme(scheme: EditorColorScheme): EditorColorScheme {
  return { ...scheme, light: { ...scheme.light }, dark: { ...scheme.dark } }
}

export function EditorColorSchemeSettings(): JSX.Element {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const isDark = useIsDark()
  const customSchemes = useMemo(
    () => normalizeEditorColorSchemes(settings.editorColorSchemes),
    [settings.editorColorSchemes]
  )
  const savedScheme = useMemo(
    () => resolveEditorColorScheme(settings),
    [settings.activeEditorColorSchemeId, settings.editorColorSchemes]
  )
  const [draft, setDraft] = useState(() => cloneScheme(savedScheme))
  const [mode, setMode] = useState<PaletteMode>(isDark ? 'dark' : 'light')
  const [previewing, setPreviewing] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameName, setRenameName] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const previewChannel = useRef<BroadcastChannel | null>(null)

  const isBuiltIn = savedScheme.id === PINE_COLOR_SCHEME_ID
  const dirty = !editorColorSchemesEqual(draft, savedScheme)
  const palette = draft[mode]

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    const channel = new BroadcastChannel(EDITOR_PALETTE_PREVIEW_CHANNEL)
    const clear = (): void => channel.postMessage({ palette: null } satisfies EditorPalettePreviewMessage)
    previewChannel.current = channel
    window.addEventListener('pagehide', clear)
    return () => {
      window.removeEventListener('pagehide', clear)
      clear()
      channel.close()
      previewChannel.current = null
    }
  }, [])

  useEffect(() => {
    setDraft(cloneScheme(savedScheme))
    setPreviewing(false)
    previewChannel.current?.postMessage({ palette: null } satisfies EditorPalettePreviewMessage)
  }, [savedScheme])

  useEffect(() => {
    if (!previewing) return
    previewChannel.current?.postMessage({
      palette: draft[isDark ? 'dark' : 'light']
    } satisfies EditorPalettePreviewMessage)
  }, [draft, isDark, previewing])

  const nameErrorText = (error: EditorColorSchemeNameError | null): string | undefined =>
    error ? t(`settings.editorColors.name${error[0].toUpperCase()}${error.slice(1)}`) : undefined

  const clearPreview = (): void => {
    setPreviewing(false)
    previewChannel.current?.postMessage({ palette: null } satisfies EditorPalettePreviewMessage)
  }

  const selectScheme = async (id: string): Promise<void> => {
    if (id === NEW_COLOR_SCHEME_ID) {
      setCreateName('')
      setCreateOpen(true)
      return
    }
    clearPreview()
    await updateSettings({ activeEditorColorSchemeId: id })
  }

  const changeColor = (key: ColorKey, value: string): void => {
    setDraft((current) => ({
      ...current,
      [mode]: { ...current[mode], [key]: value.toLowerCase() }
    }))
    setPreviewing(true)
  }

  const reset = (): void => {
    if (isBuiltIn) return
    setDraft((current) => ({
      ...current,
      light: { ...PINE_EDITOR_COLOR_SCHEME.light },
      dark: { ...PINE_EDITOR_COLOR_SCHEME.dark }
    }))
    setPreviewing(true)
  }

  const undo = (): void => {
    setDraft(cloneScheme(savedScheme))
    clearPreview()
  }

  const save = async (): Promise<void> => {
    if (isBuiltIn) return
    await updateSettings({
      editorColorSchemes: customSchemes.map((scheme) => (scheme.id === draft.id ? draft : scheme))
    })
    clearPreview()
  }

  const create = async (): Promise<void> => {
    if (editorColorSchemeNameError(createName, customSchemes)) return
    const next: EditorColorScheme = {
      id: randomUuid(),
      name: createName.trim(),
      light: { ...PINE_EDITOR_COLOR_SCHEME.light },
      dark: { ...PINE_EDITOR_COLOR_SCHEME.dark }
    }
    await updateSettings({
      activeEditorColorSchemeId: next.id,
      editorColorSchemes: [...customSchemes, next]
    })
    setCreateOpen(false)
    clearPreview()
  }

  const openRename = (): void => {
    setRenameName(savedScheme.name)
    setRenameOpen(true)
  }

  const rename = async (): Promise<void> => {
    if (isBuiltIn || editorColorSchemeNameError(renameName, customSchemes, savedScheme.id)) return
    const name = renameName.trim()
    await updateSettings({
      editorColorSchemes: customSchemes.map((scheme) => (scheme.id === savedScheme.id ? { ...scheme, name } : scheme))
    })
    setRenameOpen(false)
  }

  const remove = async (): Promise<void> => {
    if (isBuiltIn) return
    await updateSettings({
      activeEditorColorSchemeId: PINE_COLOR_SCHEME_ID,
      editorColorSchemes: customSchemes.filter((scheme) => scheme.id !== savedScheme.id)
    })
    setDeleteOpen(false)
    clearPreview()
  }

  const previewStyle = {
    background: palette.background,
    color: palette.foreground
  } satisfies CSSProperties

  const createError = editorColorSchemeNameError(createName, customSchemes)
  const renameError = editorColorSchemeNameError(renameName, customSchemes, savedScheme.id)

  return (
    <section className="mt-7 border-t border-border pt-6">
      <h2 className="mb-5 text-[15px] font-semibold">{t('settings.editorColors.title')}</h2>

      <Field label={t('settings.editorColors.scheme')} className="mb-0">
        <Select<string>
          value={savedScheme.id}
          onChange={(id) => void selectScheme(id)}
          options={[
            { label: t('settings.editorColors.pine'), value: PINE_COLOR_SCHEME_ID },
            ...customSchemes.map((scheme) => ({ label: scheme.name, value: scheme.id })),
            { label: t('settings.editorColors.newScheme'), value: NEW_COLOR_SCHEME_ID }
          ]}
        />
      </Field>

      <Tabs<PaletteMode>
        value={mode}
        onChange={setMode}
        items={[
          { value: 'light', label: t('settings.themeLight') },
          { value: 'dark', label: t('settings.themeDark') }
        ]}
        className="mb-3 mt-4"
      />

      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        {COLOR_FIELDS.map(({ key, label }) => (
          <div
            key={key}
            className="flex h-10 items-center gap-2 rounded-[var(--radius-control)] bg-[var(--surface-control)] px-2.5 text-[12px]"
          >
            {isBuiltIn ? (
              <span
                aria-hidden
                className="h-7 w-9 shrink-0 rounded border border-[var(--separator-strong)]"
                style={{ background: palette[key] }}
              />
            ) : (
              <input
                type="color"
                value={palette[key]}
                onChange={(event) => changeColor(key, event.target.value)}
                aria-label={t(`settings.editorColors.${label}`)}
                className="h-7 w-9 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
              />
            )}
            <span className="min-w-0 flex-1 truncate text-foreground">{t(`settings.editorColors.${label}`)}</span>
            <code className="text-[11px] text-muted-foreground">{palette[key]}</code>
          </div>
        ))}
      </div>

      <div className="mt-4">
        <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">{t('settings.editorColors.preview')}</div>
        <pre
          className="overflow-x-auto rounded-[var(--radius-control)] border border-border p-4 font-mono text-[12px] leading-5"
          style={previewStyle}
        >
          <span style={{ color: palette.comment }}>// {t('settings.editorColors.previewComment')}</span>
          {'\n'}
          <span style={{ color: palette.keyword }}>db.orders</span>.<span style={{ color: palette.number }}>find</span>(
          {'{'}
          {'\n  '}status: <span style={{ color: palette.string }}>'paid'</span>,{'\n  '}total: {'{'}{' '}
          <span style={{ color: palette.type }}>$gte</span>: <span style={{ color: palette.number }}>100</span> {'}'},
          {'\n  '}active: <span style={{ color: palette.keyword }}>true</span>,{'\n  '}_id:{' '}
          <span style={{ color: palette.type }}>ObjectId</span>(
          <span style={{ color: palette.string }}>'507f1f77bcf86cd799439011'</span>){'\n})'}
        </pre>
      </div>

      {!isBuiltIn && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button type="button" variant="ghost" onClick={reset}>
            {t('settings.editorColors.restorePine')}
          </Button>
          <Button type="button" variant="ghost" disabled={dirty} onClick={openRename}>
            {t('settings.editorColors.rename')}
          </Button>
          <Button type="button" variant="danger" onClick={() => setDeleteOpen(true)}>
            {t('settings.editorColors.delete')}
          </Button>
          <span className="flex-1" />
          <Button type="button" disabled={!dirty} onClick={undo}>
            {t('settings.editorColors.undo')}
          </Button>
          <Button type="button" variant="primary" disabled={!dirty} onClick={() => void save()}>
            {t('settings.editorColors.saveChanges')}
          </Button>
        </div>
      )}

      {createOpen && (
        <Modal
          small
          title={t('settings.editorColors.createTitle')}
          onClose={() => setCreateOpen(false)}
          footer={
            <>
              <span className="spacer" />
              <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
                {t('settings.editorColors.cancel')}
              </Button>
              <Button type="button" variant="primary" disabled={!!createError} onClick={() => void create()}>
                {t('settings.editorColors.create')}
              </Button>
            </>
          }
        >
          <Field label={t('settings.editorColors.name')} error={nameErrorText(createError)} className="mb-0">
            <Input
              autoFocus
              value={createName}
              maxLength={50}
              onChange={(event) => setCreateName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !createError) void create()
              }}
            />
          </Field>
        </Modal>
      )}

      {renameOpen && (
        <Modal
          small
          title={t('settings.editorColors.renameTitle')}
          onClose={() => setRenameOpen(false)}
          footer={
            <>
              <span className="spacer" />
              <Button type="button" variant="ghost" onClick={() => setRenameOpen(false)}>
                {t('settings.editorColors.cancel')}
              </Button>
              <Button type="button" variant="primary" disabled={!!renameError} onClick={() => void rename()}>
                {t('settings.editorColors.rename')}
              </Button>
            </>
          }
        >
          <Field label={t('settings.editorColors.name')} error={nameErrorText(renameError)} className="mb-0">
            <Input
              autoFocus
              value={renameName}
              maxLength={50}
              onChange={(event) => setRenameName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !renameError) void rename()
              }}
            />
          </Field>
        </Modal>
      )}

      {deleteOpen && (
        <Modal
          small
          title={t('settings.editorColors.deleteTitle')}
          description={t('settings.editorColors.deleteHint', { name: savedScheme.name })}
          onClose={() => setDeleteOpen(false)}
          footer={
            <>
              <span className="spacer" />
              <Button type="button" variant="ghost" onClick={() => setDeleteOpen(false)}>
                {t('settings.editorColors.cancel')}
              </Button>
              <Button type="button" variant="danger" onClick={() => void remove()}>
                {t('settings.editorColors.delete')}
              </Button>
            </>
          }
        >
          <div />
        </Modal>
      )}
    </section>
  )
}
