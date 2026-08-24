import { describe, expect, it } from 'vitest'
import {
  contextualTabDigitIndex,
  isAppShortcutEnabled,
  isContextualTabHintModifier,
  isMacPlatform,
  isPrimaryShortcut,
  primaryDigitIndex
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
    expect(contextualTabDigitIndex(event({ code: 'Digit3', ctrlKey: true }), true)).toBe(2)
    expect(contextualTabDigitIndex(event({ code: 'Digit3', metaKey: true }), true)).toBeNull()
  })

  it('supports number-pad digits and rejects extra modifiers', () => {
    expect(contextualTabDigitIndex(event({ code: 'Numpad8', ctrlKey: true }), true)).toBe(7)
    expect(contextualTabDigitIndex(event({ code: 'Digit1', ctrlKey: true, shiftKey: true }), true)).toBeNull()
  })

  it('recognizes a bare macOS Control hold for contextual tab hints', () => {
    expect(isContextualTabHintModifier(event({ key: 'Control', ctrlKey: true }), true)).toBe(true)
    expect(isContextualTabHintModifier(event({ key: 'Control', ctrlKey: true, shiftKey: true }), true)).toBe(false)
    expect(isContextualTabHintModifier(event({ key: 'Control', ctrlKey: true }), false)).toBe(false)
  })

  it('preserves Ctrl+number as the primary result-view shortcut off macOS', () => {
    expect(primaryDigitIndex(event({ code: 'Digit4', ctrlKey: true }), false)).toBe(3)
    expect(contextualTabDigitIndex(event({ code: 'Digit4', ctrlKey: true }), false)).toBeNull()
  })

  it('detects macOS platform names case-insensitively', () => {
    expect(isMacPlatform('MacIntel')).toBe(true)
    expect(isMacPlatform('Win32')).toBe(false)
  })

  it('supports clearing one shortcut without disabling the others', () => {
    expect(isAppShortcutEnabled(true, ['newConnection'], 'newConnection')).toBe(false)
    expect(isAppShortcutEnabled(true, ['newConnection'], 'newQuery')).toBe(true)
    expect(isAppShortcutEnabled(false, [], 'newQuery')).toBe(false)
  })
})
