import { type ReactNode } from 'react'
import { Tabs as BaseTabs } from '@base-ui/react/tabs'
import { cn } from '@renderer/lib/utils'

/**
 * Thin wrapper over Base UI Tabs — renders just the tab strip (a `tablist` with
 * roving tabindex + arrow-key nav). Panels stay the caller's concern: consumers
 * keep conditionally rendering content from the controlled `value`, so this only
 * replaces the tab button row.
 *
 * shadcn-style underline tabs: the active tab is matched by `[data-active]`
 * (blue accent underline + text).
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
      <BaseTabs.List className={cn('flex gap-3 border-b border-border', className)}>
        {items.map((it) => (
          <BaseTabs.Tab
            key={String(it.value)}
            value={it.value}
            disabled={it.disabled}
            className="relative -mb-px rounded-none border-0 border-b-2 border-transparent bg-transparent px-3 py-1.5 text-[13px] font-medium text-muted-foreground outline-none transition-colors hover:bg-transparent hover:text-foreground data-[active]:border-[var(--accent)] data-[active]:text-[var(--accent)] disabled:cursor-default disabled:opacity-50"
          >
            {it.label}
          </BaseTabs.Tab>
        ))}
      </BaseTabs.List>
    </BaseTabs.Root>
  )
}
