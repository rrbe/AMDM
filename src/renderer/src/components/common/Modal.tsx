import { type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogClose, DialogTitle } from '@renderer/components/ui/Dialog'

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
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      className={small ? 'modal small' : 'modal'}
    >
      <div className="modal-header">
        <DialogTitle render={<span />}>{title}</DialogTitle>
        <DialogClose className="ghost" aria-label={t('common.close')}>
          ✕
        </DialogClose>
      </div>
      <div className="modal-body">{children}</div>
      {footer && <div className="modal-footer">{footer}</div>}
    </Dialog>
  )
}
