import { type CSSProperties, type ReactNode } from 'react'
import { Field as BaseField } from '@base-ui/react/field'
import { cn } from '@renderer/lib/utils'

/**
 * Thin wrapper over Base UI Field — a labelled form row (label + control + hint +
 * error) in one place, with proper label↔control wiring and (optional) validation.
 *
 * shadcn-style Tailwind layout: a vertical stack with a small muted label. The
 * default bottom margin keeps stacked forms spaced; inside a grid pass
 * `className="mb-0"` (tailwind-merge drops the default).
 *
 * The control is passed as `children` (a `ui/Input`, `ui/Select`, `ui/Checkbox`,
 * …). Two error channels:
 *  - Base-UI-driven validation via `validate` / `validationMode` → rendered by the
 *    built-in `<Field.Error>` (self-hides when valid).
 *  - A manually-computed `error` string (most existing forms do their own checks)
 *    → always shown.
 */
type ValidationMode = 'onSubmit' | 'onBlur' | 'onChange'

interface FieldProps {
  label?: ReactNode
  /** Muted helper text under the control. */
  hint?: ReactNode
  /** Manually-controlled error text, always shown when present. */
  error?: ReactNode
  /** The form control element (ui/Input, ui/Select, ui/Checkbox, …). */
  children: ReactNode
  /** Field name for form submission / validation. */
  name?: string
  validationMode?: ValidationMode
  validate?: (
    value: unknown,
    formValues: Record<string, unknown>
  ) => string | string[] | null | Promise<string | string[] | null>
  disabled?: boolean
  /** Extra class(es) merged onto the row wrapper. */
  className?: string
  /** Inline style on the row wrapper (e.g. `gridColumn` inside a grid). */
  style?: CSSProperties
}

export function Field({
  label,
  hint,
  error,
  children,
  name,
  validationMode,
  validate,
  disabled,
  className,
  style
}: FieldProps): JSX.Element {
  return (
    <BaseField.Root
      className={cn('mb-3 flex flex-col gap-1.5', className)}
      style={style}
      name={name}
      validationMode={validationMode}
      validate={validate}
      disabled={disabled}
    >
      {label != null && (
        <BaseField.Label className="mb-0 text-[11px] font-medium text-muted-foreground">{label}</BaseField.Label>
      )}
      {children}
      {hint != null && <BaseField.Description className="text-[11px] text-[var(--fg-3)]">{hint}</BaseField.Description>}
      <BaseField.Error className="text-[11px] text-destructive empty:hidden" />
      {error != null && <div className="text-[11px] text-destructive">{error}</div>}
    </BaseField.Root>
  )
}

/** Re-export for advanced cases that need the raw parts (label/control/error). */
export { BaseField as FieldParts }
