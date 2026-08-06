import { NumberField as BaseNumberField } from '@base-ui/react/number-field'
import { Minus, Plus } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

/**
 * Thin wrapper over Base UI NumberField — a numeric input with −/+ steppers and
 * built-in clamping/keyboard/scrub behaviour. Used for the small integer settings
 * (page size, font size). The group matches ui/Input; the inner input is borderless.
 */
interface NumberFieldProps {
  value: number | null
  onChange: (value: number | null) => void
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  id?: string
  name?: string
  className?: string
  'aria-label'?: string
}

export function NumberField({
  value,
  onChange,
  min,
  max,
  step,
  disabled,
  id,
  name,
  className,
  'aria-label': ariaLabel
}: NumberFieldProps): JSX.Element {
  return (
    <BaseNumberField.Root
      value={value}
      onValueChange={(v) => onChange(v)}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      id={id}
      name={name}
    >
      <BaseNumberField.Group
        className={cn(
          'flex h-[38px] w-full items-stretch overflow-hidden rounded-[var(--radius-control)] border border-transparent bg-[var(--surface-control)] transition-[border-color,background-color,box-shadow] hover:bg-[var(--surface-chrome)] focus-within:border-[var(--separator-strong)] focus-within:bg-[var(--surface-elevated)] focus-within:shadow-[0_0_0_3px_var(--focus-soft)]',
          className
        )}
      >
        <BaseNumberField.Decrement
          className="inline-flex w-8 shrink-0 items-center justify-center border-0 bg-transparent text-muted-foreground transition-colors hover:bg-[var(--interaction-hover)] hover:text-foreground data-[disabled]:cursor-default data-[disabled]:opacity-40"
          aria-label="Decrease"
        >
          <Minus size={13} />
        </BaseNumberField.Decrement>
        <BaseNumberField.Input
          className="min-w-0 flex-1 border-0 bg-transparent px-1 text-center text-[13px] text-foreground outline-none focus:border-0 focus:shadow-none"
          aria-label={ariaLabel}
        />
        <BaseNumberField.Increment
          className="inline-flex w-8 shrink-0 items-center justify-center border-0 bg-transparent text-muted-foreground transition-colors hover:bg-[var(--interaction-hover)] hover:text-foreground data-[disabled]:cursor-default data-[disabled]:opacity-40"
          aria-label="Increase"
        >
          <Plus size={13} />
        </BaseNumberField.Increment>
      </BaseNumberField.Group>
    </BaseNumberField.Root>
  )
}
