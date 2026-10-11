import type { KeyboardShortcutId } from '@shared/types'

export const SHORTCUT_HINT_DELAY_MS = 500

interface ShortcutKeyEvent {
  key: string
  code: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

export function isMacPlatform(platform = navigator.platform): boolean {
  return platform.toLowerCase().includes('mac')
}

function hasPrimaryModifier(event: ShortcutKeyEvent, isMac: boolean): boolean {
  return isMac
    ? event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey
    : event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
}

export function isPrimaryShortcut(event: ShortcutKeyEvent, key: string, isMac: boolean): boolean {
  return hasPrimaryModifier(event, isMac) && event.key.toLowerCase() === key.toLowerCase()
}

/** Cmd+Shift on macOS, Ctrl+Shift elsewhere. */
export function isPrimaryShiftShortcut(event: ShortcutKeyEvent, key: string, isMac: boolean): boolean {
  const hasModifiers = isMac
    ? event.metaKey && event.shiftKey && !event.ctrlKey && !event.altKey
    : event.ctrlKey && event.shiftKey && !event.metaKey && !event.altKey
  return hasModifiers && event.key.toLowerCase() === key.toLowerCase()
}

function digitIndex(event: ShortcutKeyEvent): number | null {
  const match = /^(?:Digit|Numpad)([1-9])$/.exec(event.code)
  return match ? Number(match[1]) - 1 : null
}

/** Cmd+number on macOS, Ctrl+number elsewhere. */
export function primaryDigitIndex(event: ShortcutKeyEvent, isMac: boolean): number | null {
  return hasPrimaryModifier(event, isMac) ? digitIndex(event) : null
}

/** Cmd+Option+number on macOS, Ctrl+Alt+number elsewhere. */
export function queryTabDigitIndex(event: ShortcutKeyEvent, isMac: boolean): number | null {
  return shortcutHintModifier(event, isMac) === 'query-tabs' ? digitIndex(event) : null
}

/** macOS-only Cmd+Ctrl+number selects a result within the current query. */
export function dataTabDigitIndex(event: ShortcutKeyEvent, isMac: boolean): number | null {
  return shortcutHintModifier(event, isMac) === 'result-tabs' ? digitIndex(event) : null
}

export type ShortcutHintModifier = 'primary' | 'query-tabs' | 'result-tabs'

/** Match the modifier families used by the active platform's shortcuts. */
export function shortcutHintModifier(event: ShortcutKeyEvent, isMac: boolean): ShortcutHintModifier | null {
  if (hasPrimaryModifier(event, isMac)) return 'primary'
  if (event.shiftKey) return null
  if (isMac) {
    if (event.metaKey && event.altKey && !event.ctrlKey) return 'query-tabs'
    if (event.metaKey && event.ctrlKey && !event.altKey) return 'result-tabs'
  } else if (event.ctrlKey && event.altKey && !event.metaKey) {
    return 'query-tabs'
  }
  return null
}

/** Ctrl+Tab cycles query tabs independently of focus. */
export function queryTabDirection(event: ShortcutKeyEvent): number | null {
  if (event.key !== 'Tab' || !event.ctrlKey || event.metaKey || event.altKey) return null
  return event.shiftKey ? -1 : 1
}

/** Cmd+Ctrl+Tab cycles results independently of focus on macOS. */
export function dataTabDirection(event: ShortcutKeyEvent, isMac: boolean): number | null {
  if (!isMac || event.key !== 'Tab' || !event.metaKey || !event.ctrlKey || event.altKey) return null
  return event.shiftKey ? -1 : 1
}

/** Digits 1–8 select by position; 9 always selects the last tab. */
export function tabShortcutLabel(index: number, count: number, resultTab: boolean, isMac: boolean): string | undefined {
  if (resultTab && !isMac) return undefined
  const number = index < 8 ? index + 1 : index === count - 1 ? 9 : null
  if (number == null) return undefined
  const modifier = isMac ? (resultTab ? '⌘⌃' : '⌘⌥') : 'Ctrl+Alt+'
  return `${modifier}${number}`
}

/** Dialogs and popovers own the keyboard while open; do not act behind them. */
export function hasOpenShortcutLayer(root: ParentNode = document): boolean {
  return Array.from(root.querySelectorAll('[role="dialog"], [role="menu"], [role="listbox"]')).some((layer) =>
    layer.checkVisibility()
  )
}

export function isAppShortcutEnabled(
  enabled: boolean,
  disabled: readonly KeyboardShortcutId[],
  id: KeyboardShortcutId
): boolean {
  return enabled && !disabled.includes(id)
}
