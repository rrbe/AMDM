import { NumberField as BaseNumberField } from '@base-ui/react/number-field'
import { Minus, Plus } from 'lucide-react'

/**
 * Thin wrapper over Base UI NumberField — a numeric input with −/+ steppers and
 * built-in clamping/keyboard/scrub behaviour. Used for the small integer settings
 * (page size, font size). Styling lives under `.ui-number-*`; the input reuses the
 * global `input` look.
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
      <BaseNumberField.Group className={['ui-number', className].filter(Boolean).join(' ')}>
        <BaseNumberField.Decrement className="ui-number-btn" aria-label="Decrease">
          <Minus size={13} />
        </BaseNumberField.Decrement>
        <BaseNumberField.Input className="ui-number-input" aria-label={ariaLabel} />
        <BaseNumberField.Increment className="ui-number-btn" aria-label="Increase">
          <Plus size={13} />
        </BaseNumberField.Increment>
      </BaseNumberField.Group>
    </BaseNumberField.Root>
  )
}
