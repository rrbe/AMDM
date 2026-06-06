import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useTranslation } from 'react-i18next'
import i18n from '@renderer/i18n'
import { indentFor, toJsonLines, type JsonLine } from '@renderer/lib/format'
import { ContextMenu, type ContextMenuItem } from '@renderer/components/ContextMenu'
import { copyText, toPlainJson, toShellText, toStrictEjson } from '@renderer/lib/resultCopy'
import { useCopyHotkey } from '@renderer/lib/useCopyHotkey'

/**
 * Pretty-printed EJSON, virtualized BY LINE.
 *
 * VIRTUALIZATION APPROACH (ADR-0004 rule 1):
 *  - We flatten the whole result into a flat `JsonLine[]` once (memoized on the
 *    docs identity) instead of building one giant string and dumping it into
 *    the DOM. Each line carries its indent depth.
 *  - `useVirtualizer` then renders only the visible lines (+ overscan), so even
 *    a result that pretty-prints to hundreds of thousands of lines stays smooth.
 *
 * COPY: drag-selecting visible text + Cmd+C is native. Because lines are
 * virtualized, a native "select all" can only see on-screen lines and its
 * highlight overflows into empty space — so Cmd+A is intercepted into an
 * `allSelected` state and Cmd+C then copies the FULL reconstructed result
 * (right-click offers the three formats).
 *
 * Extended types render in shell style (ObjectId("..")/ISODate("..")) via the
 * formatter in lib/format.ts.
 */

interface JsonViewProps {
  docs: unknown[]
}

const LINE_HEIGHT = 19

export function JsonView({ docs }: JsonViewProps): JSX.Element {
  const { t } = useTranslation()
  const parentRef = useRef<HTMLDivElement>(null)
  const [allSelected, setAllSelected] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null)

  // The top-level payload is the array of docs (or the single wrapped value).
  const lines = useMemo<JsonLine[]>(() => toJsonLines(docs), [docs])

  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => LINE_HEIGHT,
    overscan: 20
  })

  // A fresh result clears any lingering "all selected" state.
  useEffect(() => setAllSelected(false), [docs])

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

  useCopyHotkey(() => (allSelected ? toPlainJson(docs) : null))

  const openMenu = (e: MouseEvent): void => {
    e.preventDefault()
    const sel = window.getSelection()
    const selText = sel && !sel.isCollapsed ? sel.toString() : ''
    const items: ContextMenuItem[] = [
      { label: i18n.t('result.copy.pureJson'), onClick: () => void copyText(toPlainJson(docs)) },
      { label: i18n.t('result.copy.mongoShell'), onClick: () => void copyText(toShellText(docs)) },
      { label: i18n.t('result.copy.extendedJson'), onClick: () => void copyText(toStrictEjson(docs)) }
    ]
    if (selText) items.unshift({ label: t('json.copySelection'), onClick: () => void copyText(selText) })
    setMenu({ x: e.clientX, y: e.clientY, items })
  }

  if (lines.length === 0) {
    return <div className="center-msg muted">{t('json.noOutput')}</div>
  }

  return (
    <div className="json-view-wrap">
      <div
        ref={parentRef}
        className={`virtual-scroller json-body${allSelected ? ' all-selected' : ''}`}
        onMouseDown={() => allSelected && setAllSelected(false)}
        onContextMenu={openMenu}
      >
        <div className="virtual-inner" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((vi) => {
            const line = lines[vi.index]
            return (
              <div
                key={vi.index}
                className="vrow json-line"
                style={{ transform: `translateY(${vi.start}px)`, height: LINE_HEIGHT }}
              >
                <pre>
                  {indentFor(line.depth)}
                  {line.tokens.map((t, i) => (
                    <span key={i} className={t.cls}>
                      {t.text}
                    </span>
                  ))}
                </pre>
              </div>
            )
          })}
        </div>
      </div>
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      )}
    </div>
  )
}
