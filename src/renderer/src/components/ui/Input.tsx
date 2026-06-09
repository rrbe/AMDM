import { type ComponentPropsWithoutRef } from 'react'
import { Input as BaseInput } from '@base-ui/react/input'

/**
 * Thin wrapper over Base UI Input — a native `<input>` that auto-wires id / aria
 * / validation state when rendered inside a `ui/Field`. Visual styling comes from
 * the global `input` rule in styles.css (unchanged), so it looks identical to the
 * raw inputs it replaces.
 *
 * Accepts the usual native props (`value`, `onChange`, `placeholder`, …); Base UI
 * additionally exposes `onValueChange(value)` if you prefer the value directly.
 */
type InputProps = ComponentPropsWithoutRef<typeof BaseInput>

export function Input(props: InputProps): JSX.Element {
  return <BaseInput {...props} />
}
