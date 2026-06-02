import { useAppStore } from '@renderer/store/useAppStore'

/** Global error toast bound to `lastError`; click to dismiss. */
export function ErrorToast(): JSX.Element | null {
  const lastError = useAppStore((s) => s.lastError)
  const clearError = useAppStore((s) => s.clearError)

  if (!lastError) return null

  return (
    <div className="toast" role="alert">
      <div className="toast-msg">{lastError}</div>
      <button className="ghost" onClick={clearError} aria-label="Dismiss">
        ✕
      </button>
    </div>
  )
}
