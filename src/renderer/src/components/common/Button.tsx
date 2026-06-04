import { type ButtonHTMLAttributes, type ReactNode } from 'react'

export type ButtonVariant = 'default' | 'primary' | 'ghost' | 'danger'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Styled tooltip text (forwarded as a `data-tip` attr; see TooltipLayer). */
  'data-tip'?: string
  variant?: ButtonVariant
  /** While true the label is kept in the layout (preserving width) but hidden,
      a spinner overlays it, and the button auto-disables (DESIGN.md §4). */
  busy?: boolean
  children?: ReactNode
}

/**
 * The standard text action button — toolbar actions and dialog footers.
 *
 * A thin, typed wrapper over `<button>` + the design-system classes. The CSS in
 * styles.css stays the single source of visual truth; this just consolidates the
 * variant API and the busy spinner so every action button behaves identically
 * (and folds in what used to be the separate BusyButton).
 *
 * NOT for icon-only buttons (`.icon-btn`), segmented toggles (`.seg` / `.active`
 * / `.selected`), or menu items — those are distinct patterns and stay as raw
 * `<button>`. Combine extra classes via `className` (e.g. `variant="ghost"
 * className="danger"` for a destructive ghost).
 */
export function Button({
  variant = 'default',
  busy = false,
  disabled,
  className,
  children,
  ...rest
}: ButtonProps): JSX.Element {
  const cls = ['busy-btn', variant === 'default' ? '' : variant, busy ? 'is-busy' : '', className ?? '']
    .filter(Boolean)
    .join(' ')
  return (
    <button {...rest} className={cls} disabled={disabled || busy} aria-busy={busy || undefined}>
      <span className="busy-btn-label">{children}</span>
      {busy && <span className="busy-btn-spinner" aria-hidden />}
    </button>
  )
}
