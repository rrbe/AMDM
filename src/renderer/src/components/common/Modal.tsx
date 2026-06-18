import { useRef, type ReactNode } from 'react'
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
}

/**
 * Minimal accessible modal. Public API unchanged (consumers conditionally mount
 * it, so mount = open); internally backed by Base UI Dialog (Esc / outside-press
 * dismissal, focus trap+restore, aria wiring). shadcn-style Tailwind shell: a
 * roomy elevated card on a dimmed backdrop. Positioning + backdrop come from
 * ui/Dialog. Three width presets keep dense dialogs tight and forms spacious.
 */
export function Modal({ title, onClose, children, footer, small, size }: ModalProps): JSX.Element {
  const { t } = useTranslation()
  const bodyRef = useRef<HTMLDivElement>(null)
  const width = small ? 'sm' : (size ?? 'md')
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      className={cn(
        'flex max-h-[88vh] max-w-[92vw] flex-col overflow-hidden rounded-xl border border-[var(--border-strong)] bg-card text-foreground shadow-[0_24px_64px_rgba(0,0,0,0.5)]',
        width === 'sm' && 'w-[480px]',
        width === 'md' && 'w-[660px]',
        width === 'lg' && 'w-[760px]'
      )}
      // Focus the first field in the body on open (preserving the old per-input
      // autoFocus); fall back to Base UI's default if the body has no control.
      initialFocus={() => bodyRef.current?.querySelector<HTMLElement>(FOCUSABLE) ?? true}
    >
      <div className="flex items-center justify-between border-b border-border px-6 py-4 text-[15px] font-semibold">
        <DialogTitle render={<span />}>{title}</DialogTitle>
        <DialogClose
          className="-mr-1.5 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground"
          aria-label={t('common.close')}
        >
          ✕
        </DialogClose>
      </div>
      <div className="overflow-y-auto px-6 py-5" ref={bodyRef}>
        {children}
      </div>
      {footer && (
        <div className="flex items-center gap-2 border-t border-border px-6 py-4 [&_.spacer]:flex-1">{footer}</div>
      )}
    </Dialog>
  )
}
