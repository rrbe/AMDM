import { type ReactNode } from 'react'
import { Tabs as BaseTabs } from '@base-ui/react/tabs'

/**
 * Thin wrapper over Base UI Tabs — renders just the tab strip (a `tablist` with
 * roving tabindex + arrow-key nav). Panels stay the caller's concern: consumers
 * keep conditionally rendering content from the controlled `value` (matches how
 * ConnectionForm already works), so this only replaces the `.tabs` button row.
 *
 * Reuses the existing `.tabs` / `.tabs button` styles; the active tab is matched
 * by `[data-selected]` (twin of the old `button.active` rule) in styles.css.
 */
export interface TabItem<T> {
  value: T
  label: ReactNode
  disabled?: boolean
}

interface TabsProps<T> {
  value: T
  onChange: (value: T) => void
  items: ReadonlyArray<TabItem<T>>
  className?: string
}

export function Tabs<T extends string | number = string>({
  value,
  onChange,
  items,
  className
}: TabsProps<T>): JSX.Element {
  return (
    <BaseTabs.Root value={value} onValueChange={(v) => onChange(v as T)}>
      <BaseTabs.List className={['tabs', className].filter(Boolean).join(' ')}>
        {items.map((it) => (
          <BaseTabs.Tab key={String(it.value)} value={it.value} disabled={it.disabled}>
            {it.label}
          </BaseTabs.Tab>
        ))}
      </BaseTabs.List>
    </BaseTabs.Root>
  )
}
