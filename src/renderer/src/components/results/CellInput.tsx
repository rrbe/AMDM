import { useEffect, useRef } from 'react'

interface CellInputProps {
  /** Pre-filled text (auto-selected on mount). */
  initial: string
  /** Red border when the last commit attempt failed validation. */
  invalid: boolean
  /** Enter pressed — attempt to save this text. */
  onCommit: (text: string) => void
  /** Esc pressed or focus lost — discard, no save. */
  onCancel: () => void
}

/**
 * The inline editor that replaces a value cell while editing. Enter commits,
 * Esc cancels, blur (clicking elsewhere) cancels without saving. Native Cmd+Z
 * text undo works because we don't intercept it. Clicks are stopped so the
 * cell's own select / double-click handlers don't fire underneath.
 */
export function CellInput({ initial, invalid, onCommit, onCancel }: CellInputProps): JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  // Guards a stray blur (e.g. on unmount) from re-firing after Enter/Esc.
  const handled = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (el) {
      el.focus()
      el.select()
    }
  }, [])

  return (
    <input
      ref={ref}
      className={invalid ? 'cell-edit-input invalid' : 'cell-edit-input'}
      defaultValue={initial}
      spellCheck={false}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          handled.current = true
          onCommit(e.currentTarget.value)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          handled.current = true
          onCancel()
        }
      }}
      onBlur={() => {
        if (!handled.current) onCancel()
      }}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    />
  )
}
