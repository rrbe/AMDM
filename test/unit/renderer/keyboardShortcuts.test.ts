import { describe, expect, it } from 'vitest'
import {
  dataTabDigitIndex,
  dataTabDirection,
  hasOpenShortcutLayer,
  isAppShortcutEnabled,
  shortcutHintModifier,
  isMacPlatform,
  isPrimaryShortcut,
  isPrimaryShiftShortcut,
  primaryDigitIndex,
  queryTabDigitIndex,
  queryTabDirection,
  tabShortcutLabel
} from '@renderer/lib/keyboardShortcuts'

const event = (
  patch: Partial<{
    key: string
    code: string
    metaKey: boolean
    ctrlKey: boolean
    altKey: boolean
    shiftKey: boolean
  }> = {}
) => ({
  key: '',
  code: '',
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...patch
})

describe('keyboard shortcuts', () => {
  it('uses Cmd as the primary modifier on macOS and Ctrl elsewhere', () => {
    expect(isPrimaryShortcut(event({ key: 'n', metaKey: true }), 'n', true)).toBe(true)
    expect(isPrimaryShortcut(event({ key: 'n', ctrlKey: true }), 'n', true)).toBe(false)
    expect(isPrimaryShortcut(event({ key: 'N', ctrlKey: true }), 'n', false)).toBe(true)
  })

  it('uses Cmd+Shift on macOS and Ctrl+Shift elsewhere', () => {
    expect(isPrimaryShiftShortcut(event({ key: 'a', metaKey: true, shiftKey: true }), 'a', true)).toBe(true)
    expect(isPrimaryShiftShortcut(event({ key: 'A', ctrlKey: true, shiftKey: true }), 'a', false)).toBe(true)
    expect(isPrimaryShiftShortcut(event({ key: 'a', metaKey: true }), 'a', true)).toBe(false)
    expect(
      isPrimaryShiftShortcut(event({ key: 'a', metaKey: true, shiftKey: true, altKey: true }), 'a', true)
    ).toBe(false)
  })

  it('keeps view, query-tab, and result-tab digits distinct on macOS', () => {
    expect(primaryDigitIndex(event({ code: 'Digit3', metaKey: true }), true)).toBe(2)
    expect(primaryDigitIndex(event({ code: 'Digit3', ctrlKey: true }), true)).toBeNull()
    const query = event({
      key: '£',
      code: 'Digit3',
      metaKey: true,
      altKey: true
    })
    const result = event({ code: 'Digit3', metaKey: true, ctrlKey: true })
    expect(queryTabDigitIndex(query, true)).toBe(2)
    expect(dataTabDigitIndex(result, true)).toBe(2)
    expect(primaryDigitIndex(query, true)).toBeNull()
    expect(primaryDigitIndex(result, true)).toBeNull()
    expect(dataTabDigitIndex(query, true)).toBeNull()
    expect(queryTabDigitIndex(result, true)).toBeNull()
    expect(queryTabDigitIndex(event({ code: 'Digit3', metaKey: true }), true)).toBeNull()
    expect(dataTabDigitIndex(event({ code: 'Digit3', ctrlKey: true }), true)).toBeNull()
  })

  it('supports number-pad digits and rejects extra modifiers', () => {
    expect(dataTabDigitIndex(event({ code: 'Numpad8', metaKey: true, ctrlKey: true }), true)).toBe(7)
    expect(queryTabDigitIndex(event({ code: 'Numpad8', metaKey: true, altKey: true }), true)).toBe(7)
    expect(dataTabDigitIndex(event({ code: 'Digit1', metaKey: true, ctrlKey: true, shiftKey: true }), true)).toBeNull()
    expect(queryTabDigitIndex(event({ code: 'Digit1', metaKey: true, altKey: true, shiftKey: true }), true)).toBeNull()
    expect(queryTabDigitIndex(event({ code: 'Digit1', metaKey: true, altKey: true, ctrlKey: true }), true)).toBeNull()
  })

  it('reveals hints for the exact modifier family, in either key order', () => {
    expect(shortcutHintModifier(event({ key: 'Meta', metaKey: true }), true)).toBe('primary')
    expect(shortcutHintModifier(event({ key: 'Control', ctrlKey: true }), true)).toBeNull()
    expect(shortcutHintModifier(event({ key: 'Control', ctrlKey: true }), false)).toBe('primary')
    expect(shortcutHintModifier(event({ key: 'Meta', metaKey: true }), false)).toBeNull()
    expect(shortcutHintModifier(event({ key: 'Control', ctrlKey: true, metaKey: true }), true)).toBe('result-tabs')
    expect(shortcutHintModifier(event({ key: 'Meta', ctrlKey: true, metaKey: true }), true)).toBe('result-tabs')
    expect(shortcutHintModifier(event({ ctrlKey: true, shiftKey: true }), true)).toBeNull()
    expect(shortcutHintModifier(event({ key: 'Alt', metaKey: true, altKey: true }), true)).toBe('query-tabs')
    expect(shortcutHintModifier(event({ key: 'Meta', metaKey: true, altKey: true }), true)).toBe('query-tabs')
    expect(shortcutHintModifier(event({ ctrlKey: true, altKey: true }), false)).toBe('query-tabs')
    expect(shortcutHintModifier(event({ ctrlKey: true, metaKey: true, altKey: true }), true)).toBeNull()
    expect(shortcutHintModifier(event(), true)).toBeNull()
  })

  it('separates Ctrl+number views from Ctrl+Alt+number query tabs off macOS', () => {
    expect(primaryDigitIndex(event({ code: 'Digit4', ctrlKey: true }), false)).toBe(3)
    expect(dataTabDigitIndex(event({ code: 'Digit4', ctrlKey: true }), false)).toBeNull()
    expect(queryTabDigitIndex(event({ code: 'Digit4', ctrlKey: true }), false)).toBeNull()
    expect(queryTabDigitIndex(event({ code: 'Digit4', ctrlKey: true, altKey: true }), false)).toBe(3)
    expect(primaryDigitIndex(event({ code: 'Digit4', ctrlKey: true, altKey: true }), false)).toBeNull()
  })

  it('cycles query tabs with Ctrl+Tab and Ctrl+Shift+Tab on every platform', () => {
    expect(queryTabDirection(event({ key: 'Tab', ctrlKey: true }))).toBe(1)
    expect(queryTabDirection(event({ key: 'Tab', ctrlKey: true, shiftKey: true }))).toBe(-1)
    expect(queryTabDirection(event({ key: 'Tab' }))).toBeNull()
    expect(queryTabDirection(event({ key: 'Tab', metaKey: true }))).toBeNull()
    expect(queryTabDirection(event({ key: 'Tab', ctrlKey: true, altKey: true }))).toBeNull()
  })

  it('cycles results with Cmd+Ctrl+Tab without also cycling query tabs', () => {
    const next = event({ key: 'Tab', metaKey: true, ctrlKey: true })
    const previous = event({ ...next, shiftKey: true })
    expect(dataTabDirection(next, true)).toBe(1)
    expect(dataTabDirection(previous, true)).toBe(-1)
    expect(queryTabDirection(next)).toBeNull()
    expect(queryTabDirection(previous)).toBeNull()
    expect(dataTabDirection(event({ key: 'Tab', ctrlKey: true }), true)).toBeNull()
    expect(dataTabDirection(event({ ...next, altKey: true }), true)).toBeNull()
    expect(dataTabDirection(next, false)).toBeNull()
  })

  it('labels only the first eight tabs and the last tab when there are more than nine', () => {
    expect(tabShortcutLabel(0, 12, false, true)).toBe('⌘⌥1')
    expect(tabShortcutLabel(7, 12, false, true)).toBe('⌘⌥8')
    expect(tabShortcutLabel(8, 12, false, true)).toBeUndefined()
    expect(tabShortcutLabel(10, 12, false, true)).toBeUndefined()
    expect(tabShortcutLabel(11, 12, false, true)).toBe('⌘⌥9')
    expect(tabShortcutLabel(8, 9, false, true)).toBe('⌘⌥9')
    expect(tabShortcutLabel(1, 2, true, true)).toBe('⌘⌃2')
    expect(tabShortcutLabel(0, 2, true, false)).toBeUndefined()
    expect(tabShortcutLabel(0, 2, false, false)).toBe('Ctrl+Alt+1')
  })

  it('detects macOS platform names case-insensitively', () => {
    expect(isMacPlatform('MacIntel')).toBe(true)
    expect(isMacPlatform('Win32')).toBe(false)
  })

  it('ignores retained hidden popups while preserving keyboard ownership for visible layers', () => {
    const root = (...visibility: boolean[]): ParentNode =>
      ({
        querySelectorAll: () => visibility.map((visible) => ({ checkVisibility: () => visible }))
      }) as unknown as ParentNode

    expect(hasOpenShortcutLayer(root())).toBe(false)
    expect(hasOpenShortcutLayer(root(false))).toBe(false)
    expect(hasOpenShortcutLayer(root(false, false))).toBe(false)
    expect(hasOpenShortcutLayer(root(false, true))).toBe(true)
  })

  it('supports clearing one shortcut without disabling the others', () => {
    expect(isAppShortcutEnabled(true, ['newConnection'], 'newConnection')).toBe(false)
    expect(isAppShortcutEnabled(true, ['newConnection'], 'newQuery')).toBe(true)
    expect(isAppShortcutEnabled(false, [], 'newQuery')).toBe(false)
  })

  it('blocks shortcuts only while a dialog or popup is visible', () => {
    const hidden = { checkVisibility: () => false }
    const visible = { checkVisibility: () => true }
    const root = (layers: object[]): ParentNode => ({ querySelectorAll: () => layers }) as unknown as ParentNode

    expect(hasOpenShortcutLayer(root([]))).toBe(false)
    expect(hasOpenShortcutLayer(root([hidden]))).toBe(false)
    expect(hasOpenShortcutLayer(root([hidden, visible]))).toBe(true)
  })
})
