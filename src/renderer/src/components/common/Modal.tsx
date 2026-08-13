import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogClose, DialogTitle } from '@renderer/components/ui/Dialog'
import { clampModalPosition } from '@renderer/lib/modalPosition'
import { cn } from '@renderer/lib/utils'

// Focusable controls we want to land initial focus on (scoped to the body, which
// excludes the header ✕). Covers native fields plus the ui/* primitives, whose
// triggers render as <button>.
const FOCUSABLE =
  'input:not([type="hidden"]), textarea, select, button, [href], [tabindex]:not([tabindex="-1"])'

interface ModalProps {
  title: string
  description?: ReactNode
  headerActions?: ReactNode
  navigation?: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  /** Width preset. `small` is kept for back-compat (= 'sm'). Default 'md'. */
  small?: boolean
  size?: 'sm' | 'md' | 'lg'
  className?: string
  bodyClassName?: string
  backdropClassName?: string
  /** Let the user move the modal by dragging its title bar. */
  movable?: boolean
  /** Keep the opening top edge fixed while body content changes height. */
  lockTop?: boolean
}

type ResizableModalProps = Omit<ModalProps, 'movable'>

interface ModalDrag {
  pointerId: number
  startX: number
  startY: number
  left: number
  top: number
}

/**
 * Minimal accessible modal. Public API unchanged (consumers conditionally mount
 * it, so mount = open); internally backed by Base UI Dialog (Esc / outside-press
 * dismissal, focus trap+restore, aria wiring). shadcn-style Tailwind shell: a
 * single elevated surface on a dimmed backdrop. Positioning + backdrop come from
 * ui/Dialog. Three width presets keep dense dialogs tight and forms spacious.
 */
export function Modal({
  title,
  description,
  headerActions,
  navigation,
  onClose,
  children,
  footer,
  small,
  size,
  className,
  bodyClassName,
  backdropClassName,
  movable = false,
  lockTop = false
}: ModalProps): React.JSX.Element {
  const { t } = useTranslation()
  const titleId = useId()
  const bodyRef = useRef<HTMLDivElement>(null)
  const popupElementRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<ModalDrag | null>(null)
  const [openingHalfHeight, setOpeningHalfHeight] = useState<number | null>(null)
  const width = small ? 'sm' : (size ?? 'md')
  const sheet = description != null || headerActions != null || navigation != null
  const popupRef = useCallback(
    (popup: HTMLDivElement | null) => {
      popupElementRef.current = popup
      if (movable && popup) {
        const rect = popup.getBoundingClientRect()
        popup.style.left = `${rect.left}px`
        popup.style.top = `${rect.top}px`
        popup.style.transform = 'none'
        return
      }
      if (lockTop && popup) {
        setOpeningHalfHeight((current) => current ?? popup.getBoundingClientRect().height / 2)
      }
    },
    [lockTop, movable]
  )

  // React 19 can mount a controlled, already-open dialog before Base UI's
  // initial-focus effect observes its body ref. Keep the focus trap's native
  // behavior, but provide a next-task fallback when focus is still outside.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const popup = popupElementRef.current
      if (!popup || popup.contains(document.activeElement)) return
      bodyRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  const startMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (
      !movable ||
      event.button !== 0 ||
      (event.target instanceof Element && event.target.closest(FOCUSABLE))
    )
      return
    const popup = popupElementRef.current
    if (!popup) return
    const rect = popup.getBoundingClientRect()
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  const move = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    const popup = popupElementRef.current
    if (!drag || drag.pointerId !== event.pointerId || !popup) return
    const rect = popup.getBoundingClientRect()
    const next = clampModalPosition(
      drag.left + event.clientX - drag.startX,
      drag.top + event.clientY - drag.startY,
      rect.width,
      rect.height,
      window.innerWidth,
      window.innerHeight
    )
    popup.style.left = `${next.left}px`
    popup.style.top = `${next.top}px`
  }

  const endMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      className={cn(
        'flex max-h-[88vh] max-w-[92vw] flex-col overflow-hidden rounded-[var(--radius-dialog)] border border-[var(--separator)] bg-[var(--surface-elevated)] text-foreground shadow-[var(--shadow-dialog)]',
        width === 'sm' && 'w-[480px]',
        width === 'md' && 'w-[660px]',
        width === 'lg' && 'w-[760px]',
        className
      )}
      backdropClassName={backdropClassName}
      popupRef={popupRef}
      aria-labelledby={titleId}
      style={
        openingHalfHeight === null
          ? undefined
          : { transform: `translate(-50%, -${openingHalfHeight}px)` }
      }
      // Focus the first field in the body on open (preserving the old per-input
      // autoFocus); fall back to Base UI's default if the body has no control.
      initialFocus={() => bodyRef.current?.querySelector<HTMLElement>(FOCUSABLE) ?? true}
    >
      <div
        className={cn(
          'flex shrink-0 justify-between',
          sheet
            ? 'items-start gap-4 px-[26px] pb-1 pt-6'
            : 'items-center border-b border-[var(--separator)] px-6 py-4 text-[15px] font-semibold',
          movable && 'cursor-move touch-none select-none'
        )}
        onPointerDown={startMove}
        onPointerMove={move}
        onPointerUp={endMove}
        onPointerCancel={endMove}
      >
        <div className="min-w-0 flex-1">
          <DialogTitle
            id={titleId}
            render={
              <span
                className={sheet ? 'text-[20px] font-semibold tracking-[-0.02em]' : undefined}
              />
            }
          >
            {title}
          </DialogTitle>
          {description != null && (
            <div className="mt-1.5 text-[12px] font-normal text-muted-foreground">
              {description}
            </div>
          )}
        </div>
        {headerActions != null && (
          <div className="flex shrink-0 items-center gap-1">{headerActions}</div>
        )}
        <DialogClose
          className="-mr-1.5 inline-flex size-7 items-center justify-center rounded-[var(--radius-control)] border-0 bg-transparent p-0 text-muted-foreground outline-none transition-colors hover:bg-[var(--interaction-hover)] hover:text-foreground focus-visible:shadow-[0_0_0_3px_var(--focus-soft)]"
          aria-label={t('common.close')}
        >
          ✕
        </DialogClose>
      </div>
      {navigation != null && (
        <div className="shrink-0 border-b border-[var(--separator)] px-[26px] pt-[18px]">
          {navigation}
        </div>
      )}
      <div
        className={cn(
          'min-h-0 overflow-y-auto',
          sheet ? 'px-[26px] pb-2 pt-[22px]' : 'px-6 py-5',
          bodyClassName
        )}
        ref={bodyRef}
      >
        {children}
      </div>
      {footer && (
        <div
          className={cn(
            'flex shrink-0 items-center gap-2 [&_.spacer]:flex-1',
            sheet ? 'px-[26px] pb-[22px] pt-4' : 'border-t border-[var(--separator)] px-6 py-4'
          )}
        >
          {footer}
        </div>
      )}
    </Dialog>
  )
}

/** Modal variant for data-heavy content: movable, resizable, and body-filling. */
export function ResizableModal({
  className,
  bodyClassName,
  ...props
}: ResizableModalProps): React.JSX.Element {
  return (
    <Modal
      {...props}
      movable
      className={cn('h-[420px] min-h-[300px] min-w-[380px] resize', className)}
      bodyClassName={cn('flex-1 overflow-hidden', bodyClassName)}
    />
  )
}
