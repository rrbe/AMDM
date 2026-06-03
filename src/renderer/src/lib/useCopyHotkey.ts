import { useEffect, useRef } from 'react'
import { copyText } from './resultCopy'

/** What a view wants copied on Cmd+C: a bare string (default toast), an object
    with a custom toast, or `null` to defer to the browser's native copy. */
export type CopyPayload = string | { text: string; notice?: string } | null

/**
 * Wire Cmd/Ctrl+C to copy a view-provided value — but only when it won't
 * clobber the browser's own copy.
 *
 * Deferral rules (any → native copy, we don't intercept):
 *  - focus is in an input / textarea / the CodeMirror editor;
 *  - a real (non-collapsed) text selection exists — the user is copying text.
 *
 * `getPayload` is held in a ref so the window listener registers once and always
 * sees fresh selection state without re-subscribing.
 */
export function useCopyHotkey(getPayload: () => CopyPayload): void {
  const ref = useRef(getPayload)
  ref.current = getPayload
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.key !== 'c' && e.key !== 'C') || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return
      const el = document.activeElement
      if (el instanceof Element && el.closest('input, textarea, [contenteditable="true"], .cm-editor')) return
      const sel = window.getSelection()
      if (sel && !sel.isCollapsed && sel.toString().length > 0) return
      const payload = ref.current()
      if (payload == null) return
      e.preventDefault()
      const text = typeof payload === 'string' ? payload : payload.text
      const notice = typeof payload === 'string' ? undefined : payload.notice
      void copyText(text, notice)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
