import { useEffect, useRef } from 'react'
import { copyText } from './resultCopy'

/**
 * Wire Cmd/Ctrl+C to copy a view-provided string — but only when it won't
 * clobber the browser's own copy. The callback returns the text to copy, or
 * `null` to defer to native copy.
 *
 * Deferral rules (any → native copy, we don't intercept):
 *  - focus is in an input / textarea / the CodeMirror editor;
 *  - a real (non-collapsed) text selection exists — the user is copying text.
 *
 * `getText` is held in a ref so the window listener registers once and always
 * sees fresh selection state without re-subscribing.
 */
export function useCopyHotkey(getText: () => string | null): void {
  const ref = useRef(getText)
  ref.current = getText
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.key !== 'c' && e.key !== 'C') || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return
      const el = document.activeElement
      if (el instanceof Element && el.closest('input, textarea, [contenteditable="true"], .cm-editor')) return
      const sel = window.getSelection()
      if (sel && !sel.isCollapsed && sel.toString().length > 0) return
      const text = ref.current()
      if (text == null) return
      e.preventDefault()
      void copyText(text)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
