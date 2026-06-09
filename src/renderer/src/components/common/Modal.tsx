import { useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogClose, DialogTitle } from '@renderer/components/ui/Dialog'

// Focusable controls we want to land initial focus on (scoped to the body, which
// excludes the header ✕). Covers native fields plus the ui/* primitives, whose
// triggers render as <button>.
const FOCUSABLE = 'input:not([type="hidden"]), textarea, select, button, [href], [tabindex]:not([tabindex="-1"])'

interface ModalProps {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  small?: boolean
}

/**
 * Minimal accessible modal. Public API unchanged (consumers conditionally mount
 * it, so mount = open); internally backed by Base UI Dialog, which provides Esc /
 * outside-press dismissal, focus trap+restore, and auto aria-labelledby wiring
 * from `Dialog.Title` — so the old keydown listener and backdrop handler are gone.
 */
export function Modal({ title, onClose, children, footer, small }: ModalProps): JSX.Element {
  const { t } = useTranslation()
  const bodyRef = useRef<HTMLDivElement>(null)
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      className={small ? 'modal small' : 'modal'}
      // Focus the first field in the body on open (preserving the old per-input
      // autoFocus); fall back to Base UI's default if the body has no control.
      initialFocus={() => bodyRef.current?.querySelector<HTMLElement>(FOCUSABLE) ?? true}
    >
      <div className="modal-header">
        <DialogTitle render={<span />}>{title}</DialogTitle>
        <DialogClose className="ghost" aria-label={t('common.close')}>
          ✕
        </DialogClose>
      </div>
      <div className="modal-body" ref={bodyRef}>
        {children}
      </div>
      {footer && <div className="modal-footer">{footer}</div>}
    </Dialog>
  )
}
