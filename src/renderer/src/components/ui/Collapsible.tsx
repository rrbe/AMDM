import type { ReactNode } from 'react'
import { Collapsible as BaseCollapsible } from '@base-ui/react/collapsible'
import { cn } from '@renderer/lib/utils'
import styles from './Collapsible.module.css'

/** Retain exiting contents only until the transition finishes. */
export function Collapsible({
  open,
  axis = 'vertical',
  className,
  children
}: {
  open: boolean
  axis?: 'horizontal' | 'vertical'
  className?: string
  children: ReactNode
}): React.JSX.Element {
  return (
    <BaseCollapsible.Root open={open} className="contents">
      <BaseCollapsible.Panel className={cn(styles.panel, styles[axis], className)} inert={!open}>
        {children}
      </BaseCollapsible.Panel>
    </BaseCollapsible.Root>
  )
}
