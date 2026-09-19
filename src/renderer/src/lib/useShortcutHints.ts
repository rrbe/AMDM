import { useEffect, useState } from 'react'
import {
  hasOpenShortcutLayer,
  isMacPlatform,
  shortcutHintModifier,
  type ShortcutHintModifier
} from './keyboardShortcuts'

const SHORTCUT_HINT_DELAY_MS = 300

export function useShortcutHints(enabled: boolean): ShortcutHintModifier | null {
  const [visibleModifier, setVisibleModifier] = useState<ShortcutHintModifier | null>(null)

  useEffect(() => {
    if (!enabled) {
      setVisibleModifier(null)
      return
    }

    const isMac = isMacPlatform()
    let heldModifier: ShortcutHintModifier | null = null
    let timer: number | null = null
    const cancelTimer = (): void => {
      if (timer !== null) window.clearTimeout(timer)
      timer = null
    }
    const hide = (): void => {
      cancelTimer()
      heldModifier = null
      setVisibleModifier(null)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      const modifier = shortcutHintModifier(event, isMac)
      if (!modifier || hasOpenShortcutLayer()) {
        hide()
        return
      }
      if (event.key !== 'Control' && event.key !== 'Meta') {
        cancelTimer()
        return
      }
      if (modifier === heldModifier) return
      hide()
      heldModifier = modifier
      timer = window.setTimeout(() => {
        timer = null
        if (!hasOpenShortcutLayer()) setVisibleModifier(modifier)
      }, SHORTCUT_HINT_DELAY_MS)
    }
    const onKeyUp = (event: KeyboardEvent): void => {
      if (shortcutHintModifier(event, isMac) !== heldModifier) hide()
    }
    const onVisibilityChange = (): void => {
      if (document.hidden) hide()
    }

    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', hide)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      cancelTimer()
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', hide)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [enabled])

  return visibleModifier
}
