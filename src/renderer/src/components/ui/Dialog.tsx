import { type ComponentProps, type ReactNode } from 'react'
import { Dialog as BaseDialog } from '@base-ui/react/dialog'

/**
 * Thin wrapper over Base UI Dialog — the single place the app touches Base UI's
 * dialog primitive (see migration plan §2: nothing else imports `@base-ui/react`).
 *
 * Controlled-only: our dialogs are driven by external state (mount = open), so we
 * expose `open` + `onOpenChange` and never use `Dialog.Trigger`. Esc and outside
 * pointer-press dismiss for free (Base UI default), so consumers can drop their
 * ad-hoc keydown/backdrop handlers.
 *
 * Styling reuses the existing `.modal-backdrop` (overlay) and whatever class the
 * consumer passes for the popup box (`.modal` / `.modal.small`); the `.ui-dialog`
 * base class only adds the fixed centering + z-index, because with Base UI the
 * Backdrop and Popup are Portal siblings (the Popup can't rely on the backdrop's
 * old flex centering).
 */
interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Extra class(es) for the popup box — typically `'modal'` or `'modal small'`. */
  className?: string
  /** Class for the backdrop overlay. Defaults to `'modal-backdrop'`; a nested
      dialog can pass its own (e.g. `'url-popup-backdrop'`) for a higher z-index. */
  backdropClassName?: string
  /** Element id of the title, wired to the popup's `aria-labelledby`. */
  'aria-labelledby'?: string
  /**
   * Where to move focus when the dialog opens. Defaults to Base UI's "first
   * tabbable element". Modal overrides this to target the first field in the
   * body (so focus doesn't land on the header ✕).
   */
  initialFocus?: ComponentProps<typeof BaseDialog.Popup>['initialFocus']
  children: ReactNode
}

export function Dialog({
  open,
  onOpenChange,
  className,
  backdropClassName = 'modal-backdrop',
  'aria-labelledby': ariaLabelledBy,
  initialFocus,
  children
}: DialogProps): JSX.Element {
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className={backdropClassName} />
        <BaseDialog.Popup
          className={['ui-dialog', className].filter(Boolean).join(' ')}
          aria-labelledby={ariaLabelledBy}
          initialFocus={initialFocus}
        >
          {children}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}

/** Closes the dialog via Base UI (triggers `onOpenChange(false)`). */
export const DialogClose = BaseDialog.Close
/** Marks the dialog title for a11y (`aria-labelledby` wiring). */
export const DialogTitle = BaseDialog.Title
/** Marks the dialog description for a11y. */
export const DialogDescription = BaseDialog.Description
