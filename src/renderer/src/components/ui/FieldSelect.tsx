import { useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { Combobox } from '@base-ui/react/combobox'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import { Checkbox } from './Checkbox'
import { Input } from './Input'
import { cn } from '@renderer/lib/utils'

type FieldSelectProps = {
  fields: string[] | undefined
  label: string
  renderField?: (field: string) => ReactNode
  trigger?: ReactElement
  side?: 'bottom' | 'right'
  className?: string
} & ({
  multiple: true
  value: string[] | null
  onChange: (value: string[] | null) => void
} | {
  multiple?: false
  value: string
  onChange: (value: string) => void
})

export function FieldSelect(props: FieldSelectProps): React.JSX.Element {
  const { fields, label, renderField, trigger, side = 'bottom', className } = props
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null)
  const items = useMemo(() => fields ?? [], [fields])
  const value = props.value ?? items
  const checked = useMemo(() => new Set(Array.isArray(value) ? value : [value]), [value])
  const allSelected = props.multiple === true && (props.value === null || (checked.size > 0 && items.every((field) => checked.has(field))))
  const options = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    return items.filter((field) => field.toLocaleLowerCase().includes(query))
  }, [items, search])
  const virtualizer = useVirtualizer({
    count: options.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => 32,
    getItemKey: (index) => options[index],
    overscan: 5
  })

  const updateOpen = (nextOpen: boolean): void => {
    if (!trigger) return
    setOpen(nextOpen)
    if (!nextOpen) setSearch('')
  }

  const content = (
    <div className={cn('flex min-h-0 flex-col gap-2', className)}>
      <Combobox.Input
        ref={inputRef}
        render={<Input className="h-7 text-xs" />}
        aria-label={t('result.searchFields')}
        placeholder={t('result.searchFields')}
      />
      {props.multiple && (
        <Checkbox
          disabled={!fields}
          checked={allSelected}
          indeterminate={!allSelected && checked.size > 0}
          label={label}
          onCheckedChange={(on) => props.onChange(on ? null : [])}
        />
      )}
      <Combobox.List ref={setScrollElement} className="h-[192px] shrink-0 overflow-auto" aria-label={label} aria-busy={!fields}>
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((row) => {
            const field = options[row.index]
            return (
              <Combobox.Item
                key={field}
                value={field}
                index={row.index}
                className="group absolute left-0 top-0 flex w-full cursor-pointer select-none items-center gap-2 rounded text-[13px] text-foreground/90 outline-none data-[highlighted]:bg-[var(--interaction-hover)]"
                style={{ height: row.size, transform: `translateY(${row.start}px)` }}
              >
                <span aria-hidden="true" className={cn(
                  'inline-flex size-[15px] shrink-0 items-center justify-center',
                  props.multiple && 'rounded-[4px] border border-[var(--separator-strong)] bg-[var(--surface-control)] group-data-[selected]:border-[var(--primary)] group-data-[selected]:bg-[var(--primary)]'
                )}>
                  <Combobox.ItemIndicator className={cn('inline-flex', props.multiple ? 'text-[var(--primary-foreground)]' : 'text-[var(--primary)]')}>
                    <Check size={12} strokeWidth={3} />
                  </Combobox.ItemIndicator>
                </span>
                <span className="min-w-0 truncate" title={field}>{renderField ? renderField(field) : field}</span>
              </Combobox.Item>
            )
          })}
        </div>
        {options.length === 0 && <span className="text-muted-foreground">{t(fields ? 'result.noMatchingFields' : 'common.loading')}</span>}
      </Combobox.List>
    </div>
  )

  return (
    <Combobox.Root<string, boolean>
      multiple={props.multiple}
      items={items}
      filteredItems={options}
      value={value}
      onValueChange={(nextValue) => {
        if (props.multiple && Array.isArray(nextValue)) props.onChange(nextValue)
        else if (!props.multiple && typeof nextValue === 'string') {
          props.onChange(nextValue)
          updateOpen(false)
        }
      }}
      inputValue={search}
      onInputValueChange={(query) => {
        setSearch(query)
        scrollElement?.scrollTo({ top: 0 })
      }}
      inline={!trigger}
      open={!trigger || open}
      onOpenChange={updateOpen}
      onOpenChangeComplete={(nextOpen) => {
        if (nextOpen && trigger) inputRef.current?.focus()
      }}
      onItemHighlighted={(field, details) => {
        if (field !== undefined && details.reason !== 'pointer') virtualizer.scrollToIndex(details.index, { align: 'auto' })
      }}
      virtualized
      autoHighlight
    >
      {trigger ? (
        <>
          <Combobox.Trigger render={trigger} />
          <Combobox.Portal>
            <Combobox.Positioner className="z-[2000]" side={side} align="start" sideOffset={4}>
              <Combobox.Popup
                initialFocus={inputRef}
                className="amdm-field-select-popup w-64 max-w-[calc(100vw-24px)] rounded-[var(--radius-control)] border border-[var(--separator-strong)] bg-[var(--surface-elevated)] p-3 text-[12px] shadow-[var(--shadow-popover)] outline-none"
              >
                {content}
              </Combobox.Popup>
            </Combobox.Positioner>
          </Combobox.Portal>
        </>
      ) : content}
    </Combobox.Root>
  )
}
