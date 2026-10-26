import { useAppStore } from '@renderer/store/useAppStore'
import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import type { JsonLine, JsonLineSource } from '@renderer/lib/format'
import { cachedResultJsonLines, createResultJsonLines } from '@renderer/lib/resultJsonLines'
import { ContextMenu, type ContextMenuEntry } from '@renderer/components/ContextMenu'
import { copyText, toPlainJson } from '@renderer/lib/resultCopy'
import { useCopyHotkey } from '@renderer/lib/useCopyHotkey'
import { resultSelectionText } from '@renderer/lib/resultTextSelection'
import { AdvancedJsonCopyModal } from './AdvancedJsonCopyModal'
import { jsonCopyMenuItems } from './documentFormatMenus'
import { useResultTimeZone } from './ResultTimeZone'
import { FoldableJsonLines, type JsonFoldingState } from './FoldableJsonLines'

/**
 * Pretty-printed EJSON, virtualized BY LINE.
 *
 * VIRTUALIZATION APPROACH:
 *  - A cancellable, chunked pass indexes container spans without formatting
 *    their contents. Only mounted lines receive text and highlighting tokens.
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
  visibleFields?: string[] | null
  onSelectFields?: () => void
  fontSize: number
  folding?: JsonFoldingState
  controlsContainer: HTMLElement | null
}

export function JsonView({ value, visibleFields = null, onSelectFields, fontSize, controlsContainer, folding }: JsonViewProps): React.JSX.Element {
  const timeZone = useResultTimeZone()
  const fieldSort = useAppStore((s) => s.settings.resultFieldSort)
  const idFirst = useAppStore((s) => s.settings.resultIdFirst)
  const { t } = useTranslation()
  const [allSelected, setAllSelected] = useState(false)
  const [advancedCopy, setAdvancedCopy] = useState<unknown[] | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuEntry[] } | null>(null)

  const input = useMemo(() => ({ value, visibleFields, timeZone, sort: fieldSort, idFirst }), [value, visibleFields, timeZone, fieldSort, idFirst])
  const [prepared, setPrepared] = useState<{ input: typeof input; lines?: JsonLineSource<JsonLine>; error?: Error }>()
  const lines = prepared?.input === input ? prepared.lines : cachedResultJsonLines(value, visibleFields, input)
  useEffect(() => {
    const cached = cachedResultJsonLines(value, visibleFields, input)
    if (cached) {
      setPrepared({ input, lines: cached })
      return
    }
    const controller = new AbortController()
    void createResultJsonLines(value, visibleFields, input, controller.signal).then(
      (lines) => { if (!controller.signal.aborted) setPrepared({ input, lines }) },
      (error: Error) => { if (!controller.signal.aborted) setPrepared({ input, error }) }
    )
    return () => controller.abort()
  }, [input])

  // A fresh result clears any lingering "all selected" state.
  useEffect(() => setAllSelected(false), [value, visibleFields])

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

  const openMenu = (e: MouseEvent<HTMLDivElement>): void => {
    e.preventDefault()
    const selText = resultSelectionText(e.currentTarget)
    const documents = Array.isArray(value) ? value : [value]
    const items: ContextMenuEntry[] = [
      ...jsonCopyMenuItems(documents, (text) => void copyText(text), setAdvancedCopy)
    ]
    if (onSelectFields) items.unshift({ label: t('result.selectFields'), onClick: onSelectFields }, 'separator')
    if (selText) items.unshift({ label: t('json.copySelection'), onClick: () => void copyText(selText) })
    setMenu({ x: e.clientX, y: e.clientY, items })
  }

  if (prepared?.input === input && prepared.error) throw prepared.error
  const displayedLines = lines ?? (prepared && prepared.input.value === value ? prepared.lines : undefined)
  if (!displayedLines) return <div className="center-msg muted" aria-busy="true">{t('common.loading')}</div>
  if (displayedLines.length === 0) {
    return <div className="center-msg muted">{t('json.noOutput')}</div>
  }

  return (
    <div className="json-view-wrap relative" aria-busy={!lines} inert={!lines}>
      {!lines && <Loader2 className="pointer-events-none absolute right-3 top-3 animate-spin" size={14} aria-label={t('common.loading')} />}
      <FoldableJsonLines
        lines={displayedLines}
        disabled={!lines}
        fontSize={fontSize}
        folding={folding}
        controlsContainer={controlsContainer}
        allSelected={allSelected}
        onMouseDown={() => setAllSelected(false)}
        onContextMenu={openMenu}
      />
      {advancedCopy && (
        <AdvancedJsonCopyModal documents={advancedCopy} onClose={() => setAdvancedCopy(null)} />
      )}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      )}
    </div>
  )
}
