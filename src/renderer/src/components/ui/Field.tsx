import { type CSSProperties, type ReactNode } from 'react'
import { Field as BaseField } from '@base-ui/react/field'

/**
 * Thin wrapper over Base UI Field — a labelled form row (label + control + hint +
 * error) in one place. Reuses the existing `.form-row` / `label` / `.hint` styles
 * so it looks identical to the hand-rolled rows it replaces, while gaining proper
 * label↔control wiring and (optional) validation.
 *
 * The control is passed as `children` (a `ui/Input`, `ui/Select`, `ui/Checkbox`,
 * …); Base UI auto-associates the label and aria with it. Two error channels:
 *  - Base-UI-driven validation via `validate` / `validationMode` → rendered by the
 *    built-in `<Field.Error>` (self-hides when valid).
 *  - A manually-computed `error` string (most existing forms do their own checks)
 *    → always shown.
 */
type ValidationMode = 'onSubmit' | 'onBlur' | 'onChange'

interface FieldProps {
  label?: ReactNode
  /** Muted helper text under the control (`.hint`). */
  hint?: ReactNode
  /** Manually-controlled error text, always shown when present (`--err`). */
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
  /** Extra class(es) merged onto the `.form-row` wrapper. */
  className?: string
  /** Inline style on the row wrapper (e.g. `gridColumn` inside a `.form-grid`). */
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
      className={['form-row', className].filter(Boolean).join(' ')}
      style={style}
      name={name}
      validationMode={validationMode}
      validate={validate}
      disabled={disabled}
    >
      {label != null && <BaseField.Label>{label}</BaseField.Label>}
      {children}
      {hint != null && <BaseField.Description className="hint">{hint}</BaseField.Description>}
      <BaseField.Error className="field-err" />
      {error != null && <div className="field-err">{error}</div>}
    </BaseField.Root>
  )
}

/** Re-export for advanced cases that need the raw parts (label/control/error). */
export { BaseField as FieldParts }
