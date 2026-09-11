import type { KeyboardShortcutId } from '@shared/types'

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

function digitIndex(event: ShortcutKeyEvent): number | null {
  const match = /^(?:Digit|Numpad)([1-9])$/.exec(event.code)
  return match ? Number(match[1]) - 1 : null
}

/** Cmd+number on macOS, Ctrl+number elsewhere. */
export function primaryDigitIndex(event: ShortcutKeyEvent, isMac: boolean): number | null {
  return hasPrimaryModifier(event, isMac) ? digitIndex(event) : null
}

/** macOS-only Ctrl+number, kept distinct from the primary Cmd+number binding. */
export function dataTabDigitIndex(event: ShortcutKeyEvent, isMac: boolean): number | null {
  if (!isMac || !event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return null
  return digitIndex(event)
}

export type ShortcutHintModifier = 'primary' | 'control'

/** Match the modifier families used by the active platform's shortcuts. */
export function shortcutHintModifier(event: ShortcutKeyEvent, isMac: boolean): ShortcutHintModifier | null {
  if (hasPrimaryModifier(event, isMac)) return 'primary'
  if (isMac && event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) return 'control'
  return null
}

/** Ctrl+Tab cycles query tabs independently of focus. */
export function queryTabDirection(event: ShortcutKeyEvent): number | null {
  if (event.key !== 'Tab' || !event.ctrlKey || event.metaKey || event.altKey) return null
  return event.shiftKey ? -1 : 1
}

export function isResultViewShortcut(event: ShortcutKeyEvent, isMac: boolean): boolean {
  if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false
  return event.code === 'Backquote' || (isMac && event.code === 'Escape')
}

export function resultViewShortcutLabel(isMac: boolean): string {
  return isMac ? '⌃` / ⌃Esc' : 'Ctrl+`'
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
