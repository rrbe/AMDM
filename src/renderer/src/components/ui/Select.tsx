import { type ReactNode } from 'react'
import { Select as BaseSelect } from '@base-ui/react/select'
import { ChevronDown, Check } from 'lucide-react'

/**
 * Thin wrapper over Base UI Select — replaces the raw `<select>` elements. Driven
 * by a simple `value / onChange / options` API; the trigger auto-renders the
 * selected option's label via the `items` prop.
 *
 * Styling (styles.css `.ui-select-*`): the trigger mimics the inset `input`/`select`
 * look (bg-2 + border + focus ring); the popup mimics `.ctx-menu`; highlighted
 * items (`[data-highlighted]`, keyboard/hover) use `--bg-3`. The popup is body-
 * portaled, so its positioner carries a z-index above dialogs (see styles.css).
 *
 * Values are strings/numbers in this app (auth type, theme, db name, …), so the
 * generic defaults to `string`.
 */
export interface SelectOption<T> {
  label: ReactNode
  value: T
  disabled?: boolean
}

interface SelectProps<T> {
  value: T
  onChange: (value: T) => void
  options: ReadonlyArray<SelectOption<T>>
  placeholder?: string
  disabled?: boolean
  id?: string
  name?: string
  /** Extra class(es) merged onto the trigger. */
  className?: string
  'aria-label'?: string
  /** Styled tooltip text, forwarded onto the trigger (see TooltipLayer). */
  'data-tip'?: string
}

export function Select<T extends string | number = string>({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  id,
  name,
  className,
  'aria-label': ariaLabel,
  'data-tip': dataTip
}: SelectProps<T>): JSX.Element {
  return (
    <BaseSelect.Root
      items={options as ReadonlyArray<{ label: ReactNode; value: T }>}
      value={value}
      onValueChange={(v) => {
        if (v !== null) onChange(v as T)
      }}
      disabled={disabled}
      id={id}
      name={name}
    >
      <BaseSelect.Trigger
        className={['ui-select-trigger', className].filter(Boolean).join(' ')}
        aria-label={ariaLabel}
        data-tip={dataTip}
      >
        <BaseSelect.Value placeholder={placeholder} />
        <BaseSelect.Icon className="ui-select-icon">
          <ChevronDown size={14} />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner
          className="ui-select-positioner"
          side="bottom"
          align="start"
          sideOffset={4}
          alignItemWithTrigger={false}
        >
          <BaseSelect.Popup className="ui-select-popup">
            <BaseSelect.List>
              {options.map((o) => (
                <BaseSelect.Item
                  key={String(o.value)}
                  value={o.value}
                  disabled={o.disabled}
                  className="ui-select-item"
                >
                  <BaseSelect.ItemText>{o.label}</BaseSelect.ItemText>
                  <BaseSelect.ItemIndicator className="ui-select-ind">
                    <Check size={14} />
                  </BaseSelect.ItemIndicator>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  )
}
