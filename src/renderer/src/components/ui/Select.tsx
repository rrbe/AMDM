import { type ReactNode } from 'react'
import { Select as BaseSelect } from '@base-ui/react/select'
import { ChevronDown, Check } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

/**
 * Thin wrapper over Base UI Select — replaces the raw `<select>` elements. Driven
 * by a simple `value / onChange / options` API; the trigger auto-renders the
 * selected option's label via the `items` prop.
 *
 * shadcn-style Tailwind skin: the trigger mimics the inset input (zinc + blue
 * focus ring); the popup is a bordered elevated card, highlighted items
 * (`[data-highlighted]`) use the subtle accent surface. The popup is body-portaled,
 * so its positioner carries a z-index above dialogs.
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
        className={cn(
          'flex h-9 w-full items-center justify-between gap-2 rounded-md border border-border bg-secondary px-3 text-left text-[13px] text-foreground outline-none transition-[border-color,box-shadow] hover:border-[var(--border-strong)] focus-visible:border-[var(--accent)] focus-visible:shadow-[0_0_0_3px_var(--accent-soft)] data-[popup-open]:border-[var(--accent)] data-[popup-open]:shadow-[0_0_0_3px_var(--accent-soft)] data-[disabled]:cursor-default data-[disabled]:opacity-55',
          className
        )}
        aria-label={ariaLabel}
        data-tip={dataTip}
      >
        <BaseSelect.Value
          placeholder={placeholder}
          className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap"
        />
        <BaseSelect.Icon className="flex shrink-0 text-muted-foreground">
          <ChevronDown size={14} />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner
          className="z-[2000]"
          side="bottom"
          align="start"
          sideOffset={4}
          alignItemWithTrigger={false}
        >
          <BaseSelect.Popup className="max-h-[var(--available-height)] min-w-[var(--anchor-width)] overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md">
            <BaseSelect.List>
              {options.map((o) => (
                <BaseSelect.Item
                  key={String(o.value)}
                  value={o.value}
                  disabled={o.disabled}
                  className="flex cursor-pointer select-none items-center gap-2 rounded-sm py-1.5 pl-2 pr-2.5 text-[13px] text-foreground/85 outline-none data-[highlighted]:bg-accent data-[highlighted]:text-foreground data-[disabled]:cursor-default data-[disabled]:opacity-50"
                >
                  <BaseSelect.ItemText>{o.label}</BaseSelect.ItemText>
                  <BaseSelect.ItemIndicator className="ml-auto inline-flex text-[var(--accent)]">
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
