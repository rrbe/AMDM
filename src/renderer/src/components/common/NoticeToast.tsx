import { useAppStore } from '@renderer/store/useAppStore'

/**
 * Transient confirmation toast bound to `notice` (e.g. "已复制"). Auto-clears
 * via the store's timer; styled as a quiet success, distinct from the red
 * ErrorToast it sits above.
 */
export function NoticeToast(): JSX.Element | null {
  const notice = useAppStore((s) => s.notice)
  if (!notice) return null
  return (
    <div className="toast toast--ok" role="status">
      <div className="toast-msg">{notice}</div>
    </div>
  )
}
