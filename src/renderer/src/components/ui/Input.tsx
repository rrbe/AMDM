import { type ComponentPropsWithoutRef } from 'react'
import { Input as BaseInput } from '@base-ui/react/input'
import { cn } from '@renderer/lib/utils'

/**
 * Thin wrapper over Base UI Input — a native `<input>` that auto-wires id / aria
 * / validation state when rendered inside a `ui/Field`. shadcn-style Tailwind
 * skin: neutral control surface and graphite focus ring.
 *
 * Accepts the usual native props (`value`, `onChange`, `placeholder`, …); Base UI
 * additionally exposes `onValueChange(value)` if you prefer the value directly.
 */
type InputProps = ComponentPropsWithoutRef<typeof BaseInput>

export function Input({ className, ...props }: InputProps): JSX.Element {
  return (
    <BaseInput
      {...props}
      className={cn(
        'flex h-[38px] w-full rounded-[var(--radius-control)] border border-transparent bg-[var(--surface-control)] px-3 text-[13px] text-foreground outline-none transition-[border-color,background-color,box-shadow] placeholder:text-[var(--text-muted)] hover:bg-[var(--surface-chrome)] focus-visible:border-[var(--separator-strong)] focus-visible:bg-[var(--surface-elevated)] focus-visible:[outline:3px_solid_var(--focus-soft)] focus-visible:shadow-none disabled:cursor-default disabled:opacity-55',
        className
      )}
    />
  )
}
