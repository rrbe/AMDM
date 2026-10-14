import {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ForwardedRef,
  type ReactNode,
  type Ref
} from 'react'
import { Combobox } from '@base-ui/react/combobox'
import { Check, Search } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

export interface SearchableSelectOption<T extends string> {
  value: T
  label: ReactNode
  filterText: string
}

export interface SearchableSelectHandle {
  open: () => void
}

interface SearchableSelectProps<T extends string> {
  value: T
  onChange: (value: T) => void
  options: ReadonlyArray<SearchableSelectOption<T>>
  matches: (filterText: string, query: string) => boolean
  triggerContent: ReactNode
  header: ReactNode
  placeholder: string
  emptyMessage: string
  className?: string
  popupClassName?: string
  'aria-label': string
}

function SearchableSelectInner<T extends string>(
  {
    value,
    onChange,
    options,
    matches,
    triggerContent,
    header,
    placeholder,
    emptyMessage,
    className,
    popupClassName,
    'aria-label': ariaLabel
  }: SearchableSelectProps<T>,
  ref: ForwardedRef<SearchableSelectHandle>
): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const optionByValue = useMemo(() => new Map(options.map((option) => [option.value, option])), [options])
  const filteredValues = useMemo(
    () => options.filter((option) => matches(option.filterText, query)).map((option) => option.value),
    [matches, options, query]
  )

  useImperativeHandle(ref, () => ({ open: () => setOpen(true) }), [])

  const updateOpen = (nextOpen: boolean): void => {
    setOpen(nextOpen)
    if (!nextOpen) setQuery('')
  }

  return (
    <Combobox.Root
      items={options.map((option) => option.value)}
      filteredItems={filteredValues}
      value={value}
      onValueChange={(nextValue) => {
        if (nextValue === null) return
        onChange(nextValue)
        updateOpen(false)
      }}
      open={open}
      onOpenChange={updateOpen}
      onOpenChangeComplete={(nextOpen) => {
        if (nextOpen) inputRef.current?.focus()
      }}
      inputValue={query}
      onInputValueChange={setQuery}
      itemToStringLabel={(optionValue) => optionByValue.get(optionValue)?.filterText ?? ''}
      autoHighlight
    >
      <Combobox.Trigger
        className={cn(
          'flex h-[38px] w-full items-center justify-center rounded-[var(--radius-control)] border border-transparent bg-[var(--surface-control)] text-foreground outline-none transition-[border-color,background-color,box-shadow] hover:bg-[var(--surface-chrome)] focus-visible:border-[var(--separator-strong)] focus-visible:bg-[var(--surface-elevated)] focus-visible:shadow-[0_0_0_3px_var(--focus-soft)] data-[popup-open]:border-[var(--separator-strong)] data-[popup-open]:bg-[var(--surface-elevated)] data-[popup-open]:shadow-[0_0_0_3px_var(--focus-soft)]',
          className
        )}
        aria-label={ariaLabel}
      >
        {triggerContent}
      </Combobox.Trigger>
      <Combobox.Portal>
        <Combobox.Positioner className="z-[2000]" side="bottom" align="start" sideOffset={4}>
          <Combobox.Popup
            initialFocus={inputRef}
            className={cn(
              'amdm-combobox-popup flex max-h-[var(--available-height)] min-w-[var(--anchor-width)] flex-col overflow-hidden rounded-[var(--radius-control)] border border-[var(--separator-strong)] bg-[var(--surface-elevated)] p-1 shadow-[var(--shadow-popover)]',
              popupClassName
            )}
          >
            <div className="relative">
              <Search
                size={15}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Combobox.Input
                ref={inputRef}
                placeholder={placeholder}
                aria-label={placeholder}
                className="h-10 w-full rounded-none border-0 bg-transparent py-1 pl-8 pr-3 text-[13px] text-foreground shadow-none outline-none placeholder:text-[var(--fg-3)] focus:border-0 focus:bg-transparent focus:shadow-none"
              />
            </div>
            <div className="px-2 py-2 text-[11px] font-medium text-muted-foreground">{header}</div>
            <Combobox.List className="min-h-0 overflow-y-auto">
              {(optionValue: T) => {
                const option = optionByValue.get(optionValue)
                if (!option) return null
                return (
                  <Combobox.Item
                    key={option.value}
                    value={option.value}
                    className="flex cursor-pointer select-none items-center gap-2 rounded-[4px] py-1.5 pl-2 pr-2.5 text-[13px] text-foreground/85 outline-none data-[highlighted]:bg-[var(--interaction-hover)] data-[highlighted]:text-foreground"
                  >
                    <span className="min-w-0 flex-1">{option.label}</span>
                    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
                      <Combobox.ItemIndicator className="inline-flex text-[var(--primary)]">
                        <Check size={14} />
                      </Combobox.ItemIndicator>
                    </span>
                  </Combobox.Item>
                )
              }}
            </Combobox.List>
            <Combobox.Empty>
              <div className="px-3 py-5 text-center text-[12px] text-muted-foreground">{emptyMessage}</div>
            </Combobox.Empty>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  )
}

export const SearchableSelect = forwardRef(SearchableSelectInner) as <T extends string>(
  props: SearchableSelectProps<T> & { ref?: Ref<SearchableSelectHandle> }
) => React.JSX.Element
