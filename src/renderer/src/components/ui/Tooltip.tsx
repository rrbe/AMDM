import { type ReactElement, type ReactNode } from 'react'
import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip'

/**
 * Thin wrapper over Base UI Tooltip — wraps a single trigger element and shows a
 * styled popup on hover/focus. Reuses the `.app-tooltip` look (styles.css).
 *
 * NOTE: the app currently shows tooltips via the global `data-tip` + `TooltipLayer`
 * singleton; per the migration plan this per-trigger primitive is the eventual
 * replacement but is intentionally NOT wired in yet (low risk/reward, last slice).
 * It exists so future work can adopt it incrementally.
 */
interface TooltipProps {
  content: ReactNode
  /** A single element to use as the trigger (props are merged onto it). */
  children: ReactElement
  side?: 'top' | 'bottom' | 'left' | 'right'
  sideOffset?: number
}

export function Tooltip({ content, children, side = 'top', sideOffset = 6 }: TooltipProps): JSX.Element {
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner className="ui-tooltip-positioner" side={side} sideOffset={sideOffset}>
          <BaseTooltip.Popup className="app-tooltip ui-tooltip-popup">{content}</BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  )
}
