import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react'
import type { NotificationVariant } from '@renderer/lib/notifications'

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
  title,
  detail,
  repeatCount,
  onDismiss,
  autoDismissMs
}: {
  variant: NotificationVariant
  title: string
  detail?: string
  repeatCount?: number
  onDismiss: () => void
  autoDismissMs: number | null
}): React.JSX.Element {
  const { t } = useTranslation()
  const onDismissRef = useRef(onDismiss)
  const timerRef = useRef<number | null>(null)
  const startedAtRef = useRef(0)
  const remainingRef = useRef(autoDismissMs ?? 0)
  const hoveredRef = useRef(false)
  const focusWithinRef = useRef(false)
  const rootRef = useRef<HTMLDivElement>(null)

  onDismissRef.current = onDismiss

  const clearTimer = (): void => {
    if (timerRef.current === null) return
    window.clearTimeout(timerRef.current)
    timerRef.current = null
  }

  const completeTimer = (): void => {
    timerRef.current = null
    const root = rootRef.current
    if (root?.matches(':hover') || root?.contains(document.activeElement)) {
      remainingRef.current = 100
      startedAtRef.current = Date.now()
      timerRef.current = window.setTimeout(completeTimer, remainingRef.current)
      return
    }
    onDismissRef.current()
  }

  const startTimer = (): void => {
    if (
      autoDismissMs === null ||
      hoveredRef.current ||
      focusWithinRef.current ||
      timerRef.current !== null ||
      remainingRef.current <= 0
    ) {
      return
    }
    startedAtRef.current = Date.now()
    timerRef.current = window.setTimeout(completeTimer, remainingRef.current)
  }

  const pauseTimer = (): void => {
    if (timerRef.current === null) return
    remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAtRef.current))
    clearTimer()
  }

  useEffect(() => {
    const root = rootRef.current
    const onMouseEnter = (): void => {
      hoveredRef.current = true
      pauseTimer()
    }
    const onMouseLeave = (): void => {
      hoveredRef.current = false
      startTimer()
    }
    const onFocusIn = (): void => {
      focusWithinRef.current = true
      pauseTimer()
    }
    const onFocusOut = (event: FocusEvent): void => {
      if (!root?.contains(event.relatedTarget as Node | null)) {
        focusWithinRef.current = false
        startTimer()
      }
    }

    remainingRef.current = autoDismissMs ?? 0
    root?.addEventListener('mouseenter', onMouseEnter)
    root?.addEventListener('mouseleave', onMouseLeave)
    root?.addEventListener('focusin', onFocusIn)
    root?.addEventListener('focusout', onFocusOut)
    startTimer()
    return () => {
      clearTimer()
      root?.removeEventListener('mouseenter', onMouseEnter)
      root?.removeEventListener('mouseleave', onMouseLeave)
      root?.removeEventListener('focusin', onFocusIn)
      root?.removeEventListener('focusout', onFocusOut)
    }
  }, [autoDismissMs])

  const Icon = ICONS[variant]
  return (
    <div ref={rootRef} className={`toast toast-${variant}`} role={variant === 'error' ? 'alert' : 'status'}>
      <Icon className="toast-icon" size={16} aria-hidden />
      <div className="toast-content">
        <div className="toast-title">
          {title}
          {!!repeatCount && repeatCount > 1 && <span className="toast-count">×{repeatCount}</span>}
        </div>
        {detail && <div className="toast-detail">{detail}</div>}
      </div>
      <button className="toast-close" onClick={onDismiss} aria-label={t('common.dismiss')}>
        <X size={14} />
      </button>
    </div>
  )
}
