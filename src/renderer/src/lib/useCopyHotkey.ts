import { useEffect, useRef } from 'react'
import { copyText } from './resultCopy'
import { useAppStore } from '@renderer/store/useAppStore'
import i18n from '@renderer/i18n'

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
/**
 * Click-to-focus for the result grids (Tree/Table/JSON scrollers): move focus
 * off the query editor AND drop any text selection lingering OUTSIDE the grid.
 * The grids are `user-select: none`, so a click on a row does NOT natively
 * collapse a selection left in the editor (e.g. after select-all / run
 * selection) — and that stale selection would trip deferral rule (b) below,
 * handing ⌘C to native copy which then copies nothing (the selection's element
 * isn't focused). A selection INSIDE the grid (JSON text) is the user's own
 * copy intent — leave it alone.
 */
export function claimCopyFocus(el: HTMLElement | null): void {
  if (!el) return
  el.focus({ preventScroll: true })
  const sel = window.getSelection()
  if (sel && !sel.isCollapsed && sel.anchorNode && !el.contains(sel.anchorNode)) {
    sel.removeAllRanges()
  }
}

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
      // Confirm the copy with a transient toast — the keyboard path is otherwise
      // invisible, so without it a successful ⌘C reads as "nothing happened".
      void copyText(text).then((ok) => {
        if (ok) useAppStore.getState().notify('success', i18n.t('notify.copied'))
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
