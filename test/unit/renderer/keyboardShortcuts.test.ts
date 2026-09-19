import { describe, expect, it } from 'vitest'
import {
  dataTabDigitIndex,
  hasOpenShortcutLayer,
  isAppShortcutEnabled,
  shortcutHintModifier,
  isMacPlatform,
  isPrimaryShortcut,
  primaryDigitIndex,
  queryTabDirection,
  isResultViewShortcut
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

  it('keeps macOS Cmd+number and Ctrl+number as separate shortcut families', () => {
    expect(primaryDigitIndex(event({ code: 'Digit3', metaKey: true }), true)).toBe(2)
    expect(primaryDigitIndex(event({ code: 'Digit3', ctrlKey: true }), true)).toBeNull()
    expect(dataTabDigitIndex(event({ code: 'Digit3', ctrlKey: true }), true)).toBe(2)
    expect(dataTabDigitIndex(event({ code: 'Digit3', metaKey: true }), true)).toBeNull()
  })

  it('supports number-pad digits and rejects extra modifiers', () => {
    expect(dataTabDigitIndex(event({ code: 'Numpad8', ctrlKey: true }), true)).toBe(7)
    expect(dataTabDigitIndex(event({ code: 'Digit1', ctrlKey: true, shiftKey: true }), true)).toBeNull()
  })

  it('maps held Cmd and Ctrl to their shortcut hint families', () => {
    expect(shortcutHintModifier(event({ key: 'Meta', metaKey: true }), true)).toBe('primary')
    expect(shortcutHintModifier(event({ key: 'Control', ctrlKey: true }), true)).toBe('control')
    expect(shortcutHintModifier(event({ key: 'Control', ctrlKey: true }), false)).toBe('primary')
    expect(shortcutHintModifier(event({ key: 'Meta', metaKey: true }), false)).toBeNull()
    expect(shortcutHintModifier(event({ ctrlKey: true, metaKey: true }), true)).toBeNull()
    expect(shortcutHintModifier(event({ ctrlKey: true, shiftKey: true }), true)).toBeNull()
    expect(shortcutHintModifier(event({ metaKey: true, altKey: true }), true)).toBeNull()
    expect(shortcutHintModifier(event(), true)).toBeNull()
  })

  it('preserves Ctrl+number as the primary query-tab shortcut off macOS', () => {
    expect(primaryDigitIndex(event({ code: 'Digit4', ctrlKey: true }), false)).toBe(3)
    expect(dataTabDigitIndex(event({ code: 'Digit4', ctrlKey: true }), false)).toBeNull()
  })

  it('cycles query tabs with Ctrl+Tab and Ctrl+Shift+Tab on every platform', () => {
    expect(queryTabDirection(event({ key: 'Tab', ctrlKey: true }))).toBe(1)
    expect(queryTabDirection(event({ key: 'Tab', ctrlKey: true, shiftKey: true }))).toBe(-1)
    expect(queryTabDirection(event({ key: 'Tab' }))).toBeNull()
    expect(queryTabDirection(event({ key: 'Tab', metaKey: true }))).toBeNull()
    expect(queryTabDirection(event({ key: 'Tab', ctrlKey: true, altKey: true }))).toBeNull()
  })

  it('reserves bare Ctrl+backquote for cycling data views', () => {
    expect(isResultViewShortcut(event({ code: 'Backquote', ctrlKey: true }), true)).toBe(true)
    expect(isResultViewShortcut(event({ code: 'Backquote', metaKey: true }), true)).toBe(false)
    expect(isResultViewShortcut(event({ code: 'Backquote', ctrlKey: true, shiftKey: true }), true)).toBe(false)
    expect(isResultViewShortcut(event({ code: 'Backquote', ctrlKey: true, altKey: true }), true)).toBe(false)
    expect(isResultViewShortcut(event({ code: 'Digit1', ctrlKey: true }), true)).toBe(false)
  })

  it('supports Ctrl+Escape for shared Escape/backquote keys on macOS only', () => {
    expect(isResultViewShortcut(event({ key: 'Escape', code: 'Escape', ctrlKey: true }), true)).toBe(true)
    expect(isResultViewShortcut(event({ key: 'Escape', code: 'Escape', ctrlKey: true }), false)).toBe(false)
    expect(isResultViewShortcut(event({ key: 'Escape', code: 'Escape' }), true)).toBe(false)
    expect(isResultViewShortcut(event({ code: 'Escape', ctrlKey: true, shiftKey: true }), true)).toBe(false)
    expect(isResultViewShortcut(event({ code: 'Escape', ctrlKey: true, metaKey: true }), true)).toBe(false)
    expect(isResultViewShortcut(event({ code: 'Escape', ctrlKey: true, altKey: true }), true)).toBe(false)
    expect(isResultViewShortcut(event({ code: 'Backquote', ctrlKey: true }), false)).toBe(true)
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
