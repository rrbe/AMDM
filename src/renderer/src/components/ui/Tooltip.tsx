import type { ReactElement, ReactNode } from 'react'
import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip'
import { cva } from 'class-variance-authority'

export type TooltipVariant = 'compact' | 'text' | 'code'

export type TooltipContent = ReactNode | (() => ReactNode)

interface TooltipPayload {
  content: TooltipContent
  footer?: TooltipContent
  variant: TooltipVariant
}

interface TooltipProps {
  content?: TooltipContent
  children: ReactElement
  footer?: TooltipContent
  variant?: TooltipVariant
  overflowOnly?: boolean
  disabled?: boolean
}

interface TooltipChildProps {
  disabled?: boolean
  'aria-label'?: string
}

const SHOW_DELAY = 700
const tooltipHandle = BaseTooltip.createHandle<TooltipPayload>()
const OVERFLOW_ONLY_ATTR = 'data-tooltip-overflow-only'

const popupVariants = cva(
  'app-tooltip pointer-events-auto cursor-text select-text whitespace-pre-wrap rounded-[var(--radius-control)] border-0 bg-primary text-primary-foreground shadow-[var(--shadow-popover)] outline-none [overflow-wrap:anywhere]',
  {
    variants: {
      variant: {
        compact:
          'max-w-[min(360px,calc(100vw-16px))] px-[10px] py-[7px] font-sans text-[12px] font-medium leading-[1.35]',
        text: 'max-h-[min(320px,45vh)] max-w-[min(520px,calc(100vw-16px))] overflow-hidden px-3 py-2.5 font-sans text-[12px] font-normal leading-[1.45]',
        code: 'max-h-[min(320px,45vh)] max-w-[min(520px,calc(100vw-16px))] overflow-auto px-3 py-2.5 font-mono text-[12px] font-normal leading-[1.45] [tab-size:2]'
      }
    },
    defaultVariants: { variant: 'compact' }
  }
)

function hasContent(content: TooltipContent | undefined): content is TooltipContent {
  return content != null && (typeof content !== 'string' || content.trim().length > 0)
}

function resolveContent(content: TooltipContent): ReactNode {
  return typeof content === 'function' ? content() : content
}

function isOverflowing(element: HTMLElement): boolean {
  return element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight
}

/** Shared trigger; native disabled controls get a focusable wrapper because they do not emit hover events. */
export function Tooltip({
  content,
  children,
  footer,
  variant = 'compact',
  overflowOnly = false,
  disabled = false
}: TooltipProps): React.JSX.Element {
  const contentAvailable = hasContent(content)
  if (!contentAvailable || disabled) return children

  const childProps = children.props as TooltipChildProps
  const trigger = childProps.disabled ? (
    <span
      className="inline-flex [&>*]:pointer-events-none"
      role="button"
      aria-disabled="true"
      aria-label={childProps['aria-label']}
      tabIndex={0}
    >
      {children}
    </span>
  ) : (
    children
  )

  return (
    <BaseTooltip.Trigger
      handle={tooltipHandle}
      payload={{ content, footer: hasContent(footer) ? footer : undefined, variant }}
      delay={SHOW_DELAY}
      {...(overflowOnly ? { [OVERFLOW_ONLY_ATTR]: '' } : {})}
      render={trigger}
    />
  )
}

/** One body-portaled popup shared by every detached Tooltip trigger. */
export function TooltipLayer(): React.JSX.Element {
  return (
    <BaseTooltip.Root
      handle={tooltipHandle}
      disableHoverablePopup={false}
      onOpenChange={(open, eventDetails) => {
        const trigger = eventDetails.trigger
        if (
          open &&
          trigger instanceof HTMLElement &&
          trigger.hasAttribute(OVERFLOW_ONLY_ATTR) &&
          !isOverflowing(trigger)
        ) {
          eventDetails.cancel()
        }
      }}
    >
      {({ payload }) => (
        <BaseTooltip.Portal>
          <BaseTooltip.Positioner
            className="z-[3000]"
            side="top"
            align="center"
            sideOffset={6}
            collisionPadding={8}
            collisionAvoidance={{ side: 'flip', align: 'shift', fallbackAxisSide: 'end' }}
          >
            <BaseTooltip.Popup
              className={`${popupVariants({ variant: payload?.variant ?? 'compact' })}${payload?.footer ? ' flex flex-col' : ''}`}
              data-variant={payload?.variant ?? 'compact'}
            >
              {payload ? (
                payload.footer ? (
                  <>
                    <div className="min-h-0 overflow-hidden">{resolveContent(payload.content)}</div>
                    <div className="mt-2 shrink-0 border-t border-primary-foreground/20 pt-2 font-sans text-[11px] leading-[1.35] text-primary-foreground/70">
                      {resolveContent(payload.footer)}
                    </div>
                  </>
                ) : (
                  resolveContent(payload.content)
                )
              ) : null}
            </BaseTooltip.Popup>
          </BaseTooltip.Positioner>
        </BaseTooltip.Portal>
      )}
    </BaseTooltip.Root>
  )
}
