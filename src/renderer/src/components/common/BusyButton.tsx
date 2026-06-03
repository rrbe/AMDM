import { type ButtonHTMLAttributes, type ReactNode } from 'react'

interface BusyButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** While true the label is kept in the layout (preserving width) but hidden,
      and a centered spinner overlays it. The button is auto-disabled. */
  busy?: boolean
  children: ReactNode
}

/**
 * A button whose width never changes between its idle and in-flight states.
 *
 * DESIGN.md §4 (Buttons) forbids swapping the label across states (e.g.
 * "Run" → "Running…", "Save" → "Saving…") — the width change nudges neighbours
 * and reads as a flicker. Instead the label stays in flow but turns invisible,
 * and a spinner is overlaid; the box keeps the idle label's size exactly.
 */
export function BusyButton({
  busy = false,
  disabled,
  className,
  children,
  ...rest
}: BusyButtonProps): JSX.Element {
  const cls = ['busy-btn', busy ? 'is-busy' : '', className].filter(Boolean).join(' ')
  return (
    <button {...rest} className={cls} disabled={disabled || busy} aria-busy={busy}>
      <span className="busy-btn-label">{children}</span>
      {busy && <span className="busy-btn-spinner" aria-hidden />}
    </button>
  )
}
