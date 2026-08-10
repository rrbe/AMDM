import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type EditorColorScheme } from '@shared/types'
import {
  PINE_EDITOR_COLOR_SCHEME,
  applyEditorColorPalette,
  editorColorSchemeNameError,
  normalizeEditorColorSchemes,
  normalizeEditorColorPalette,
  resolveEditorColorScheme
} from '@renderer/lib/editorColorScheme'

const custom: EditorColorScheme = {
  id: 'custom',
  name: 'Ocean',
  light: { ...PINE_EDITOR_COLOR_SCHEME.light, string: '#112233' },
  dark: { ...PINE_EDITOR_COLOR_SCHEME.dark, string: '#aabbcc' }
}

describe('editorColorScheme', () => {
  it('resolves the active custom scheme and falls back to Pine', () => {
    expect(resolveEditorColorScheme({ activeEditorColorSchemeId: custom.id, editorColorSchemes: [custom] })).toEqual(
      custom
    )
    expect(resolveEditorColorScheme({ activeEditorColorSchemeId: 'missing', editorColorSchemes: [custom] })).toEqual(
      PINE_EDITOR_COLOR_SCHEME
    )
    expect(resolveEditorColorScheme(DEFAULT_SETTINGS)).toEqual(PINE_EDITOR_COLOR_SCHEME)
  })

  it('normalizes colors per field without discarding valid custom values', () => {
    expect(
      normalizeEditorColorPalette(
        { ...PINE_EDITOR_COLOR_SCHEME.light, string: '#AABBCC', number: 'nope' },
        PINE_EDITOR_COLOR_SCHEME.light
      )
    ).toEqual({
      ...PINE_EDITOR_COLOR_SCHEME.light,
      string: '#aabbcc'
    })
  })

  it('drops malformed schemes and repairs invalid palette fields', () => {
    expect(
      normalizeEditorColorSchemes([
        null,
        { id: '', name: 'No id' },
        { ...custom, id: PINE_EDITOR_COLOR_SCHEME.id, name: 'Fake Pine' },
        { ...custom, light: { ...custom.light, number: 'bad' } }
      ])
    ).toEqual([
      {
        ...custom,
        light: { ...custom.light, number: PINE_EDITOR_COLOR_SCHEME.light.number }
      }
    ])
  })

  it('validates required, bounded and unique scheme names', () => {
    expect(editorColorSchemeNameError(' ', [custom])).toBe('required')
    expect(editorColorSchemeNameError('x'.repeat(51), [custom])).toBe('tooLong')
    expect(editorColorSchemeNameError(' ocean ', [custom])).toBe('duplicate')
    expect(editorColorSchemeNameError('Ocean', [custom], custom.id)).toBeNull()
  })

  it('applies editor and result semantic variables together', () => {
    const values: Record<string, string> = {}
    const root = {
      style: { setProperty: (key: string, value: string) => (values[key] = value) }
    } as unknown as HTMLElement

    applyEditorColorPalette(root, custom.light)

    expect(values['--editor-string']).toBe('#112233')
    expect(values['--t-string']).toBe('#112233')
    expect(values['--t-date']).toBe(custom.light.number)
    expect(values['--t-special']).toBe(custom.light.type)
  })
})
