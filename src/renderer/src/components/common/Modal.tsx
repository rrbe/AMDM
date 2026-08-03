import { useCallback, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogClose, DialogTitle } from '@renderer/components/ui/Dialog'
import { cn } from '@renderer/lib/utils'

// Focusable controls we want to land initial focus on (scoped to the body, which
// excludes the header ✕). Covers native fields plus the ui/* primitives, whose
// triggers render as <button>.
const FOCUSABLE = 'input:not([type="hidden"]), textarea, select, button, [href], [tabindex]:not([tabindex="-1"])'

interface ModalProps {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  /** Width preset. `small` is kept for back-compat (= 'sm'). Default 'md'. */
  small?: boolean
  size?: 'sm' | 'md' | 'lg'
  /** Keep the opening top edge fixed while body content changes height. */
  lockTop?: boolean
}

/**
 * Minimal accessible modal. Public API unchanged (consumers conditionally mount
 * it, so mount = open); internally backed by Base UI Dialog (Esc / outside-press
 * dismissal, focus trap+restore, aria wiring). shadcn-style Tailwind shell: a
 * roomy elevated card on a dimmed backdrop. Positioning + backdrop come from
 * ui/Dialog. Three width presets keep dense dialogs tight and forms spacious.
 */
export function Modal({
  title,
  onClose,
  children,
  footer,
  small,
  size,
  lockTop = false
}: ModalProps): JSX.Element {
  const { t } = useTranslation()
  const bodyRef = useRef<HTMLDivElement>(null)
  const [openingHalfHeight, setOpeningHalfHeight] = useState<number | null>(null)
  const width = small ? 'sm' : (size ?? 'md')
  const popupRef = useCallback(
    (popup: HTMLDivElement | null) => {
      if (lockTop && popup) {
        setOpeningHalfHeight((current) => current ?? popup.getBoundingClientRect().height / 2)
      }
    },
    [lockTop]
  )

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      className={cn(
        'flex max-h-[88vh] max-w-[92vw] flex-col overflow-hidden rounded-xl border border-[var(--border-strong)] bg-card text-foreground shadow-[var(--shadow-lg)]',
        width === 'sm' && 'w-[480px]',
        width === 'md' && 'w-[660px]',
        width === 'lg' && 'w-[760px]'
      )}
      popupRef={popupRef}
      style={
        openingHalfHeight === null
          ? undefined
          : { transform: `translate(-50%, -${openingHalfHeight}px)` }
      }
      // Focus the first field in the body on open (preserving the old per-input
      // autoFocus); fall back to Base UI's default if the body has no control.
      initialFocus={() => bodyRef.current?.querySelector<HTMLElement>(FOCUSABLE) ?? true}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4 text-[15px] font-semibold">
        <DialogTitle render={<span />}>{title}</DialogTitle>
        <DialogClose
          className="-mr-1.5 inline-flex size-7 items-center justify-center rounded-md border-0 bg-transparent p-0 text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground"
          aria-label={t('common.close')}
        >
          ✕
        </DialogClose>
      </div>
      <div className="min-h-0 overflow-y-auto px-6 py-5" ref={bodyRef}>
        {children}
      </div>
      {footer && (
        <div className="flex shrink-0 items-center gap-2 border-t border-border px-6 py-4 [&_.spacer]:flex-1">
          {footer}
        </div>
      )}
    </Dialog>
  )
}
