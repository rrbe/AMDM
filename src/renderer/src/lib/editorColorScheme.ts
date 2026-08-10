import { PINE_COLOR_SCHEME_ID, type AppSettings, type EditorColorPalette, type EditorColorScheme } from '@shared/types'

export const EDITOR_COLOR_KEYS = [
  'background',
  'foreground',
  'keyword',
  'string',
  'number',
  'type',
  'comment'
] as const satisfies ReadonlyArray<keyof EditorColorPalette>

export const PINE_EDITOR_COLOR_SCHEME: EditorColorScheme = {
  id: PINE_COLOR_SCHEME_ID,
  name: 'Pine',
  light: {
    background: '#fafafa',
    foreground: '#202124',
    keyword: '#8657b8',
    string: '#237f50',
    number: '#4565c4',
    type: '#a95732',
    comment: '#898c93'
  },
  dark: {
    background: '#1b1b1e',
    foreground: '#f1f1f3',
    keyword: '#c5a0f0',
    string: '#67c78f',
    number: '#79a7ff',
    type: '#ff9b73',
    comment: '#858890'
  }
}

export const EDITOR_PALETTE_PREVIEW_CHANNEL = 'amdm-editor-palette-preview'

export interface EditorPalettePreviewMessage {
  palette: EditorColorPalette | null
}

export type EditorColorSchemeNameError = 'required' | 'tooLong' | 'duplicate'

const HEX_COLOR = /^#[0-9a-f]{6}$/i

export function isEditorColorPalette(value: unknown): value is EditorColorPalette {
  if (!value || typeof value !== 'object') return false
  const palette = value as Record<string, unknown>
  return EDITOR_COLOR_KEYS.every((key) => typeof palette[key] === 'string' && HEX_COLOR.test(palette[key]))
}

export function normalizeEditorColorPalette(value: unknown, fallback: EditorColorPalette): EditorColorPalette {
  const input = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return Object.fromEntries(
    EDITOR_COLOR_KEYS.map((key) => [
      key,
      typeof input[key] === 'string' && HEX_COLOR.test(input[key]) ? input[key].toLowerCase() : fallback[key]
    ])
  ) as unknown as EditorColorPalette
}

export function normalizeEditorColorSchemes(value: unknown): EditorColorScheme[] {
  if (!Array.isArray(value)) return []
  const schemes = new Map<string, EditorColorScheme>()
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const candidate = raw as Partial<EditorColorScheme>
    const id = typeof candidate.id === 'string' ? candidate.id.trim() : ''
    const name = typeof candidate.name === 'string' ? candidate.name.trim() : ''
    if (!id || id === PINE_COLOR_SCHEME_ID || !name || schemes.has(id)) continue
    schemes.set(id, {
      id,
      name,
      light: normalizeEditorColorPalette(candidate.light, PINE_EDITOR_COLOR_SCHEME.light),
      dark: normalizeEditorColorPalette(candidate.dark, PINE_EDITOR_COLOR_SCHEME.dark)
    })
  }
  return [...schemes.values()]
}

export function resolveEditorColorScheme(
  settings: Pick<AppSettings, 'activeEditorColorSchemeId' | 'editorColorSchemes'>
): EditorColorScheme {
  if (settings.activeEditorColorSchemeId === PINE_COLOR_SCHEME_ID) return PINE_EDITOR_COLOR_SCHEME
  return (
    normalizeEditorColorSchemes(settings.editorColorSchemes).find(
      (scheme) => scheme.id === settings.activeEditorColorSchemeId
    ) ?? PINE_EDITOR_COLOR_SCHEME
  )
}

export function editorColorSchemesEqual(a: EditorColorScheme, b: EditorColorScheme): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    EDITOR_COLOR_KEYS.every((key) => a.light[key] === b.light[key] && a.dark[key] === b.dark[key])
  )
}

export function editorColorSchemeNameError(
  name: string,
  schemes: readonly EditorColorScheme[],
  ignoreId?: string
): EditorColorSchemeNameError | null {
  const normalized = name.trim()
  if (!normalized) return 'required'
  if (normalized.length > 50) return 'tooLong'
  return schemes.some(
    (scheme) => scheme.id !== ignoreId && scheme.name.trim().toLocaleLowerCase() === normalized.toLocaleLowerCase()
  )
    ? 'duplicate'
    : null
}

export function applyEditorColorPalette(root: HTMLElement, palette: EditorColorPalette): void {
  for (const key of EDITOR_COLOR_KEYS) root.style.setProperty(`--editor-${key}`, palette[key])
  root.style.setProperty('--t-key', palette.foreground)
  root.style.setProperty('--t-string', palette.string)
  root.style.setProperty('--t-number', palette.number)
  root.style.setProperty('--t-boolean', palette.keyword)
  root.style.setProperty('--t-objectId', palette.type)
  root.style.setProperty('--t-date', palette.number)
  root.style.setProperty('--t-binary', palette.type)
  root.style.setProperty('--t-regex', palette.keyword)
  root.style.setProperty('--t-special', palette.type)
}
