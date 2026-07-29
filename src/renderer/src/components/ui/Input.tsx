import { type ComponentPropsWithoutRef } from 'react'
import { Input as BaseInput } from '@base-ui/react/input'
import { cn } from '@renderer/lib/utils'

/**
 * Thin wrapper over Base UI Input — a native `<input>` that auto-wires id / aria
 * / validation state when rendered inside a `ui/Field`. shadcn-style Tailwind
 * skin: Stone inset field, Ink focus ring.
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
        'flex h-9 w-full rounded-md border border-border bg-secondary px-3 text-[13px] text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-[var(--fg-3)] focus-visible:border-[var(--accent)] focus-visible:shadow-[0_0_0_3px_var(--accent-soft)] disabled:cursor-default disabled:opacity-55',
        className
      )}
    />
  )
}
