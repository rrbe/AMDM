import { useAppStore } from '@renderer/store/useAppStore'
import { visibleNotifications } from '@renderer/lib/notifications'
import { Toast } from './Toast'

/**
 * The global bottom-right notification stack. Only the newest bounded subset
 * is mounted; dismissing one reveals the next queued notification.
 */
export function Toaster(): React.JSX.Element | null {
  const notifications = useAppStore((s) => s.notifications)
  const dismissNotification = useAppStore((s) => s.dismissNotification)
  const visible = visibleNotifications(notifications)

  if (visible.length === 0) return null

  return (
    <div className="toast-stack">
      {visible.map((notification) => (
        <Toast
          key={`${notification.id}:${notification.updatedAt}:${notification.repeatCount}`}
          variant={notification.variant}
          title={notification.title}
          detail={notification.detail}
          repeatCount={notification.repeatCount}
          onDismiss={() => dismissNotification(notification.id)}
          autoDismissMs={notification.autoDismissMs}
        />
      ))}
    </div>
  )
}
