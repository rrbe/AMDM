import { type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@renderer/lib/utils'

/**
 * The standard text action button — toolbar actions and dialog footers.
 *
 * shadcn-style: a `<button>` styled with Tailwind utilities via `cva` variants.
 * Keeps the no-width-change busy pattern (DESIGN.md §4): the label stays in the
 * layout but hidden while a spinner overlays it (`.busy-btn*` lives in base.css),
 * and the button auto-disables.
 *
 * NOT for icon-only buttons, segmented toggles, or menu items — those are
 * distinct patterns and stay as raw `<button>`.
 */
const buttonVariants = cva(
  'busy-btn relative inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-[13px] font-medium leading-none select-none outline-none transition-colors focus-visible:shadow-[0_0_0_3px_var(--accent-soft)] disabled:opacity-50 disabled:cursor-default [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'h-8 px-3 border border-border bg-secondary text-foreground hover:bg-accent hover:border-[var(--border-strong)]',
        primary: 'h-8 px-3.5 bg-primary text-primary-foreground shadow-sm hover:bg-[var(--accent-hover)]',
        ghost: 'h-8 px-3 text-foreground hover:bg-accent',
        danger: 'h-8 px-3 text-destructive hover:bg-destructive/10'
      }
    },
    defaultVariants: { variant: 'default' }
  }
)

export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>['variant']>

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Styled tooltip text (forwarded as a `data-tip` attr; see TooltipLayer). */
  'data-tip'?: string
  variant?: ButtonVariant
  /** While true the label is kept in the layout (preserving width) but hidden,
      a spinner overlays it, and the button auto-disables (DESIGN.md §4). */
  busy?: boolean
  children?: ReactNode
}

export function Button({
  variant = 'default',
  busy = false,
  disabled,
  className,
  children,
  ...rest
}: ButtonProps): JSX.Element {
  return (
    <button
      {...rest}
      className={cn(buttonVariants({ variant }), busy && 'is-busy', className)}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
    >
      <span className="busy-btn-label">{children}</span>
      {busy && <span className="busy-btn-spinner" aria-hidden />}
    </button>
  )
}
