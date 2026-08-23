export type NotificationVariant = 'error' | 'success' | 'info' | 'warn'

export type NotificationSource = 'connection' | 'query' | 'catalog' | 'document' | 'io' | 'settings' | 'system'

export interface NotificationInput {
  variant: NotificationVariant
  title: string
  detail?: string
  source: NotificationSource
  /** Repeated notifications with the same key are merged while queued. */
  dedupeKey?: string
  /** `null` persists until dismissed; omitted uses the variant default. */
  autoDismissMs?: number | null
}

export interface AppNotification extends Omit<NotificationInput, 'autoDismissMs'> {
  id: string
  createdAt: number
  updatedAt: number
  repeatCount: number
  autoDismissMs: number | null
}

export const MAX_NOTIFICATIONS = 20
export const MAX_VISIBLE_NOTIFICATIONS = 3

export function defaultNotificationDuration(variant: NotificationVariant): number | null {
  if (variant === 'error') return null
  if (variant === 'warn') return 8_000
  return 4_000
}

/**
 * Add one notification to an oldest-first, bounded queue. A live `dedupeKey`
 * is updated and moved to the newest position so bursts stay visible without
 * growing the queue or DOM indefinitely.
 */
export function enqueueNotification(
  notifications: AppNotification[],
  input: NotificationInput,
  meta: { id: string; now: number }
): AppNotification[] {
  const matchingIndex = input.dedupeKey
    ? notifications.findIndex((notification) => notification.dedupeKey === input.dedupeKey)
    : -1
  const autoDismissMs =
    input.autoDismissMs === undefined ? defaultNotificationDuration(input.variant) : input.autoDismissMs

  if (matchingIndex >= 0) {
    const matching = notifications[matchingIndex]
    const next = notifications.filter((_, index) => index !== matchingIndex)
    next.push({
      ...matching,
      ...input,
      autoDismissMs,
      updatedAt: meta.now,
      repeatCount: matching.variant === input.variant ? matching.repeatCount + 1 : 1
    })
    return next
  }

  const next: AppNotification[] = [
    ...notifications,
    {
      ...input,
      id: meta.id,
      createdAt: meta.now,
      updatedAt: meta.now,
      repeatCount: 1,
      autoDismissMs
    }
  ]

  while (next.length > MAX_NOTIFICATIONS) {
    const transientIndex = next.findIndex((notification) => notification.autoDismissMs !== null)
    next.splice(transientIndex >= 0 ? transientIndex : 0, 1)
  }
  return next
}

export function dismissNotification(notifications: AppNotification[], id: string): AppNotification[] {
  return notifications.filter((notification) => notification.id !== id)
}

export function visibleNotifications(notifications: AppNotification[]): AppNotification[] {
  return notifications.slice(-MAX_VISIBLE_NOTIFICATIONS)
}
