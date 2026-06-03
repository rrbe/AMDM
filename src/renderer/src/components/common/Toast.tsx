import { useEffect } from 'react'
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react'

export type ToastVariant = 'error' | 'success' | 'info' | 'warn'

const ICONS = {
  error: CircleAlert,
  success: CircleCheck,
  info: Info,
  warn: TriangleAlert
} as const

/**
 * A single toast: an opaque elevated surface with a severity-colored left bar +
 * icon. Opaque on purpose — the old `.toast` used the translucent `--err-bg`
 * tint, so whatever sat behind it bled through. `error` persists until
 * dismissed; transient kinds auto-dismiss via `autoDismissMs`.
 */
export function Toast({
  variant,
  message,
  onDismiss,
  autoDismissMs
}: {
  variant: ToastVariant
  message: string
  onDismiss: () => void
  autoDismissMs?: number
}): JSX.Element {
  useEffect(() => {
    if (!autoDismissMs) return
    const t = window.setTimeout(onDismiss, autoDismissMs)
    return () => window.clearTimeout(t)
  }, [autoDismissMs, onDismiss])

  const Icon = ICONS[variant]
  return (
    <div className={`toast toast-${variant}`} role={variant === 'error' ? 'alert' : 'status'}>
      <Icon className="toast-icon" size={16} aria-hidden />
      <div className="toast-msg">{message}</div>
      <button className="toast-close" onClick={onDismiss} aria-label="Dismiss">
        <X size={14} />
      </button>
    </div>
  )
}
