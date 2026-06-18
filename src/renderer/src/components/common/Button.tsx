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
  'busy-btn relative inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium leading-none select-none outline-none transition-colors focus-visible:shadow-[0_0_0_3px_var(--accent-soft)] disabled:opacity-50 disabled:cursor-default [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'border border-border bg-secondary text-foreground hover:bg-accent hover:border-[var(--border-strong)]',
        primary: 'bg-primary text-primary-foreground shadow-sm hover:bg-[var(--accent-hover)]',
        ghost: 'text-foreground hover:bg-accent',
        danger: 'text-destructive hover:bg-destructive/10'
      },
      size: {
        default: 'h-8 px-3 text-[13px] [&_svg]:size-4',
        sm: 'h-7 px-2.5 text-[12px] [&_svg]:size-3.5'
      }
    },
    defaultVariants: { variant: 'default', size: 'default' }
  }
)

export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>['variant']>
export type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>['size']>

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Styled tooltip text (forwarded as a `data-tip` attr; see TooltipLayer). */
  'data-tip'?: string
  variant?: ButtonVariant
  /** `default` (h-8) for dialogs/toolbars; `sm` (h-7) for compact strips. */
  size?: ButtonSize
  /** While true the label is kept in the layout (preserving width) but hidden,
      a spinner overlays it, and the button auto-disables (DESIGN.md §4). */
  busy?: boolean
  children?: ReactNode
}

export function Button({
  variant = 'default',
  size = 'default',
  busy = false,
  disabled,
  className,
  children,
  ...rest
}: ButtonProps): JSX.Element {
  return (
    <button
      {...rest}
      className={cn(buttonVariants({ variant, size }), busy && 'is-busy', className)}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
    >
      <span className="busy-btn-label">{children}</span>
      {busy && <span className="busy-btn-spinner" aria-hidden />}
    </button>
  )
}
