import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '@renderer/i18n'
import { toJsonLines } from '@renderer/lib/format'
import { ContextMenu, type ContextMenuEntry } from '@renderer/components/ContextMenu'
import { copyText, toPlainJson, toShellText } from '@renderer/lib/resultCopy'
import { useCopyHotkey } from '@renderer/lib/useCopyHotkey'
import { jsonCopyMenuItems } from './documentFormatMenus'
import { FoldableJsonLines, type JsonFoldingState } from './FoldableJsonLines'

/**
 * Pretty-printed EJSON, virtualized BY LINE.
 *
 * VIRTUALIZATION APPROACH:
 *  - We flatten the whole result into a flat `JsonLine[]` once (memoized on the
 *    docs identity) instead of building one giant string and dumping it into
 *    the DOM. Each line carries its indent depth.
 *  - `useVirtualizer` then renders only the visible lines (+ overscan), so even
 *    a result that pretty-prints to hundreds of thousands of lines stays smooth.
 *
 * COPY: drag-selecting visible text + Cmd+C is native. With no drag-selection,
 * Cmd+C copies the FULL reconstructed result as pure JSON (the view has no
 * per-row selection). Because lines are virtualized, a native "select all" can
 * only see on-screen lines and its highlight overflows into empty space — so
 * Cmd+A is intercepted into an `allSelected` state for the highlight (right-
 * click offers the three formats).
 *
 * Extended types render in shell style (ObjectId("..")/ISODate("..")) via the
 * formatter in lib/format.ts.
 */

interface JsonViewProps {
  value: unknown
  fontSize: number
  folding?: JsonFoldingState
  controlsContainer: HTMLElement | null
}

export function JsonView({ value, fontSize, controlsContainer, folding }: JsonViewProps): React.JSX.Element {
  const { t } = useTranslation()
  const [allSelected, setAllSelected] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuEntry[] } | null>(null)

  // The top-level payload is the array of docs (or the single wrapped value).
  const lines = useMemo(() => toJsonLines(value), [value])

  // A fresh result clears any lingering "all selected" state.
  useEffect(() => setAllSelected(false), [value])

  // Cmd/Ctrl+A → mark the whole result selected (and kill the overflowing
  // native select-all). Cmd+C then copies the full plain JSON.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.key !== 'a' && e.key !== 'A') || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return
      const el = document.activeElement
      if (el instanceof Element && el.closest('input, textarea, [contenteditable="true"], .cm-editor')) return
      e.preventDefault()
      window.getSelection()?.removeAllRanges()
      setAllSelected(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ⌘C with no drag-selection copies the whole result as pure JSON (the JSON
  // view has no per-row/cell selection model); a real text selection still
  // falls through to native copy inside useCopyHotkey.
  useCopyHotkey(() => toPlainJson(value))

  const openMenu = (e: MouseEvent): void => {
    e.preventDefault()
    const sel = window.getSelection()
    const selText = sel && !sel.isCollapsed ? sel.toString() : ''
    const documents = Array.isArray(value) ? value : [value]
    const items: ContextMenuEntry[] = [
      ...jsonCopyMenuItems(documents, (text) => void copyText(text)),
      { label: i18n.t('result.copy.mongoShell'), onClick: () => void copyText(toShellText(value)) }
    ]
    if (selText) items.unshift({ label: t('json.copySelection'), onClick: () => void copyText(selText) })
    setMenu({ x: e.clientX, y: e.clientY, items })
  }

  if (lines.length === 0) {
    return <div className="center-msg muted">{t('json.noOutput')}</div>
  }

  return (
    <div className="json-view-wrap">
      <FoldableJsonLines
        lines={lines}
        fontSize={fontSize}
        folding={folding}
        controlsContainer={controlsContainer}
        allSelected={allSelected}
        onMouseDown={() => setAllSelected(false)}
        onContextMenu={openMenu}
      />
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      )}
    </div>
  )
}
