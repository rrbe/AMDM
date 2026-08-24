import type { KeyboardShortcutId } from '@shared/types'

export type ShortcutRegion = 'query' | 'result'

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
export function contextualTabDigitIndex(event: ShortcutKeyEvent, isMac: boolean): number | null {
  if (!isMac || !event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return null
  return digitIndex(event)
}

/** Holding Control on macOS reveals the contextual tab-number hints. */
export function isContextualTabHintModifier(event: ShortcutKeyEvent, isMac: boolean): boolean {
  return isMac && event.key === 'Control' && event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
}

export function shortcutRegionFromTarget(target: EventTarget | null): ShortcutRegion | null {
  if (!(target instanceof Element)) return null
  const region = target.closest<HTMLElement>('[data-shortcut-region]')?.dataset.shortcutRegion
  return region === 'query' || region === 'result' ? region : null
}

/** Dialogs and popovers own the keyboard while open; do not act behind them. */
export function hasOpenShortcutLayer(root: ParentNode = document): boolean {
  return root.querySelector('[role="dialog"], [role="menu"], [role="listbox"]') != null
}

export function isAppShortcutEnabled(
  enabled: boolean,
  disabled: readonly KeyboardShortcutId[],
  id: KeyboardShortcutId
): boolean {
  return enabled && !disabled.includes(id)
}
