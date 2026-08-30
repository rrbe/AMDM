import { useRef, type ReactNode } from 'react'
import { Select as BaseSelect } from '@base-ui/react/select'
import { ChevronDown, Check, CircleHelp } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { Tooltip } from './Tooltip'

/**
 * Thin wrapper over Base UI Select — replaces the raw `<select>` elements. Driven
 * by a simple `value / onChange / options` API; the trigger auto-renders the
 * selected option's label via the `items` prop.
 *
 * shadcn-style Tailwind skin: the trigger uses the control surface and graphite
 * focus ring; the popup is a bordered elevated surface, highlighted items
 * (`[data-highlighted]`) use the subtle accent surface. The popup is body-portaled,
 * so its positioner carries a z-index above dialogs.
 */
export interface SelectOption<T> {
  label: ReactNode
  value: T
  disabled?: boolean
  /** Optional explanation shown only beside this option in the open popup. */
  description?: ReactNode
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
  /** Optional compact trigger content; options still provide the popup labels. */
  triggerContent?: ReactNode
  popupHeader?: ReactNode
  popupClassName?: string
  'aria-label'?: string
}

function SelectOptionHelp({ label, description }: { label: ReactNode; description: ReactNode }): React.JSX.Element {
  const triggerRef = useRef<HTMLSpanElement>(null)
  return (
    <Tooltip
      content={description}
      variant="text"
      delay={100}
      anchor={() => triggerRef.current?.closest('.amdm-select-popup') ?? null}
      align="end"
    >
      <span
        ref={triggerRef}
        className="inline-flex h-5 w-5 cursor-help items-center justify-center text-muted-foreground outline-none hover:text-foreground focus-visible:rounded-sm focus-visible:text-foreground focus-visible:shadow-[0_0_0_2px_var(--focus-soft)]"
        role="button"
        tabIndex={0}
        aria-label={
          typeof label === 'string' && typeof description === 'string' ? `${label}: ${description}` : undefined
        }
        onPointerDown={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <CircleHelp size={13} />
      </span>
    </Tooltip>
  )
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
  triggerContent,
  popupHeader,
  popupClassName,
  'aria-label': ariaLabel
}: SelectProps<T>): React.JSX.Element {
  const hasDescriptions = options.some((option) => option.description != null)

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
          'flex h-[38px] w-full items-center justify-between gap-2 rounded-[var(--radius-control)] border border-transparent bg-[var(--surface-control)] px-3 text-left text-[13px] text-foreground outline-none transition-[border-color,background-color,box-shadow] hover:bg-[var(--surface-chrome)] focus-visible:border-[var(--separator-strong)] focus-visible:bg-[var(--surface-elevated)] focus-visible:shadow-[0_0_0_3px_var(--focus-soft)] data-[popup-open]:border-[var(--separator-strong)] data-[popup-open]:bg-[var(--surface-elevated)] data-[popup-open]:shadow-[0_0_0_3px_var(--focus-soft)] data-[disabled]:cursor-default data-[disabled]:opacity-55',
          className
        )}
        aria-label={ariaLabel}
      >
        {triggerContent ?? (
          <BaseSelect.Value
            placeholder={placeholder}
            className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap"
          />
        )}
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
          <BaseSelect.Popup
            className={cn(
              'amdm-select-popup max-h-[var(--available-height)] min-w-[var(--anchor-width)] overflow-y-auto rounded-[var(--radius-control)] border border-[var(--separator-strong)] bg-[var(--surface-elevated)] p-1 shadow-[var(--shadow-popover)]',
              popupClassName
            )}
          >
            {popupHeader}
            <BaseSelect.List>
              {options.map((o) => (
                <BaseSelect.Item
                  key={String(o.value)}
                  value={o.value}
                  disabled={o.disabled}
                  className="flex cursor-pointer select-none items-center gap-2 rounded-[4px] py-1.5 pl-2 pr-2.5 text-[13px] text-foreground/85 outline-none data-[highlighted]:bg-[var(--interaction-hover)] data-[highlighted]:text-foreground data-[disabled]:cursor-default data-[disabled]:opacity-50"
                >
                  <BaseSelect.ItemText className="min-w-0 flex-1">{o.label}</BaseSelect.ItemText>
                  {hasDescriptions ? (
                    <>
                      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
                        {o.description != null && (
                          <SelectOptionHelp label={o.label} description={o.description} />
                        )}
                      </span>
                      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
                        <BaseSelect.ItemIndicator className="inline-flex text-[var(--primary)]">
                          <Check size={14} />
                        </BaseSelect.ItemIndicator>
                      </span>
                    </>
                  ) : (
                    <BaseSelect.ItemIndicator className="ml-auto inline-flex text-[var(--primary)]">
                      <Check size={14} />
                    </BaseSelect.ItemIndicator>
                  )}
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  )
}
