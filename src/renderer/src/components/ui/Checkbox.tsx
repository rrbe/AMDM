import { type ReactNode } from 'react'
import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox'
import { Check } from 'lucide-react'

/**
 * Thin wrapper over Base UI Checkbox — a labelled checkbox where the whole row is
 * the clickable control (Base UI renders a `role="checkbox"` button, so wrapping
 * the box + label inside `Checkbox.Root` makes both toggle it). Replaces the raw
 * `<input type="checkbox">` + sibling `<label>` pattern, fixing the flaky native
 * label/click behaviour the migration plan calls out.
 *
 * Styling lives in styles.css under `.ui-check*`; checked state is driven by the
 * `data-checked` attribute Base UI sets on the root.
 */
interface CheckboxProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  label?: ReactNode
  disabled?: boolean
  id?: string
  name?: string
  /** Extra class(es) merged onto the root row. */
  className?: string
}

export function Checkbox({
  checked,
  onCheckedChange,
  label,
  disabled,
  id,
  name,
  className
}: CheckboxProps): JSX.Element {
  return (
    <BaseCheckbox.Root
      className={['ui-check', className].filter(Boolean).join(' ')}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      id={id}
      name={name}
    >
      <span className="ui-check-box" aria-hidden>
        <BaseCheckbox.Indicator className="ui-check-ind">
          <Check size={12} strokeWidth={3} />
        </BaseCheckbox.Indicator>
      </span>
      {label != null && <span className="ui-check-label">{label}</span>}
    </BaseCheckbox.Root>
  )
}
