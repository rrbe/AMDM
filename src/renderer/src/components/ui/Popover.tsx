import type { ReactElement, ReactNode } from 'react'
import { Popover as BasePopover } from '@base-ui/react/popover'

export function Popover({
  trigger,
  label,
  children
}: {
  trigger: ReactElement
  label: string
  children: ReactNode
}): React.JSX.Element {
  return (
    <BasePopover.Root>
      <BasePopover.Trigger render={trigger} />
      <BasePopover.Portal>
        <BasePopover.Positioner side="bottom" align="end" sideOffset={6} className="z-[100]">
          <BasePopover.Popup
            aria-label={label}
            className="max-w-[min(280px,calc(100vw-24px))] rounded-[var(--radius-control)] bg-[var(--surface-elevated)] px-3 py-2 text-[12px] leading-relaxed text-foreground shadow-[var(--shadow-popover)] outline-none"
          >
            {children}
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  )
}
