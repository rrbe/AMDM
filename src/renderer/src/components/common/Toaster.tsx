import { useAppStore } from '@renderer/store/useAppStore'
import { Toast } from './Toast'

/**
 * The global toast stack (bottom-right). Renders the error channel (`lastError`,
 * persists until dismissed) and the transient notice channel (`notice`,
 * success/info auto-dismiss; warnings persist).
 */
export function Toaster(): JSX.Element | null {
  const lastError = useAppStore((s) => s.lastError)
  const clearError = useAppStore((s) => s.clearError)
  const notice = useAppStore((s) => s.notice)
  const dismissNotice = useAppStore((s) => s.dismissNotice)

  if (!lastError && !notice) return null

  return (
    <div className="toast-stack">
      {notice && (
        <Toast
          key={notice.key}
          variant={notice.kind}
          message={notice.message}
          onDismiss={dismissNotice}
          autoDismissMs={notice.kind === 'warn' ? undefined : 4000}
        />
      )}
      {lastError && <Toast variant="error" message={lastError} onDismiss={clearError} />}
    </div>
  )
}
