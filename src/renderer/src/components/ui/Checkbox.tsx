import { type ReactNode } from 'react'
import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox'
import { Check } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

/**
 * Thin wrapper over Base UI Checkbox — a labelled checkbox where the whole row is
 * the clickable control (Base UI renders a `role="checkbox"` button, so wrapping
 * the box + label inside `Checkbox.Root` makes both toggle it).
 *
 * shadcn-style Tailwind skin: the box fills with the blue accent when checked
 * (driven by the root's `data-checked`, read via the `group` pattern).
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
      className={cn(
        'group m-0 inline-flex w-auto cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-left text-[13px] text-foreground/90 outline-none hover:bg-transparent disabled:cursor-default disabled:opacity-55',
        className
      )}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      id={id}
      name={name}
    >
      <span
        className="inline-flex size-[15px] shrink-0 items-center justify-center rounded-[4px] border border-[var(--border-strong)] bg-secondary transition-colors group-data-[checked]:border-[var(--accent)] group-data-[checked]:bg-[var(--accent)] group-focus-visible:border-[var(--accent)] group-focus-visible:shadow-[0_0_0_3px_var(--accent-soft)]"
        aria-hidden
      >
        <BaseCheckbox.Indicator className="inline-flex text-[var(--accent-fg)]">
          <Check size={12} strokeWidth={3} />
        </BaseCheckbox.Indicator>
      </span>
      {label != null && <span className="select-none">{label}</span>}
    </BaseCheckbox.Root>
  )
}
