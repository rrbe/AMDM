import { useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { ShellOutputLine } from '@shared/types'
import { indentFor } from '@renderer/lib/format'
import { consoleText, toConsoleLines } from '@renderer/lib/consoleOutput'
import { claimCopyFocus, useCopyHotkey } from '@renderer/lib/useCopyHotkey'

/**
 * Console output of a run: every print/printjson/console.* line, in call
 * order, virtualized BY LINE like the JSON view (ADR-0004 rule 1 — a
 * forEach(printjson) easily produces thousands of lines). printjson payloads
 * reuse the JSON view's shell-style tokens; warn/error lines are tinted.
 * Text is natively selectable; ⌘C with no selection copies the whole console.
 */

interface ConsoleViewProps {
  output: ShellOutputLine[]
  /** True when the engine dropped lines beyond the capture cap. */
  truncated?: boolean
}

const LINE_HEIGHT = 19

export function ConsoleView({ output, truncated }: ConsoleViewProps): JSX.Element {
  const { t } = useTranslation()
  const parentRef = useRef<HTMLDivElement>(null)

  const lines = useMemo(() => toConsoleLines(output), [output])

  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => LINE_HEIGHT,
    overscan: 20
  })

  useCopyHotkey(() => consoleText(output))

  return (
    <div className="console-view-wrap">
      {truncated && <div className="console-truncated">{t('result.consoleTruncated')}</div>}
      <div
        ref={parentRef}
        className="virtual-scroller json-body"
        // Focusable so a click claims the ⌘C hotkey (mirrors the other result
        // views); a drag-selection of the console text still copies natively.
        tabIndex={-1}
        onMouseDown={() => claimCopyFocus(parentRef.current)}
      >
        <div className="virtual-inner" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((vi) => {
            const line = lines[vi.index]
            return (
              <div
                key={vi.index}
                className={`vrow json-line console-line${line.level !== 'log' ? ` ${line.level}` : ''}`}
                style={{ transform: `translateY(${vi.start}px)`, height: LINE_HEIGHT }}
              >
                <pre>
                  {indentFor(line.depth)}
                  {line.tokens ? (
                    line.tokens.map((tk, i) => (
                      <span key={i} className={tk.cls}>
                        {tk.text}
                      </span>
                    ))
                  ) : (
                    line.text
                  )}
                </pre>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
