import { useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { indentFor, toJsonLines, type JsonLine } from '@renderer/lib/format'

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
 * Extended types render in shell style (ObjectId("..")/ISODate("..")) via the
 * formatter in lib/format.ts.
 */

interface JsonViewProps {
  docs: unknown[]
}

const LINE_HEIGHT = 19

export function JsonView({ docs }: JsonViewProps): JSX.Element {
  const parentRef = useRef<HTMLDivElement>(null)

  // The top-level payload is the array of docs (or the single wrapped value).
  const lines = useMemo<JsonLine[]>(() => toJsonLines(docs), [docs])

  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => LINE_HEIGHT,
    overscan: 20
  })

  if (lines.length === 0) {
    return <div className="center-msg muted">No output.</div>
  }

  return (
    <div ref={parentRef} className="virtual-scroller">
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
  )
}
