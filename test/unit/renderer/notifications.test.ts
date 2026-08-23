import { describe, expect, it } from 'vitest'
import {
  MAX_NOTIFICATIONS,
  dismissNotification,
  enqueueNotification,
  visibleNotifications,
  type AppNotification,
  type NotificationInput
} from '../../../src/renderer/src/lib/notifications'

const error = (title: string, dedupeKey?: string): NotificationInput => ({
  variant: 'error',
  title,
  source: 'system',
  dedupeKey
})

function add(notifications: AppNotification[], input: NotificationInput, index: number): AppNotification[] {
  return enqueueNotification(notifications, input, { id: `n-${index}`, now: index })
}

describe('notification queue', () => {
  it('keeps errors persistent and transient variants bounded by default', () => {
    let notifications = add([], error('failed'), 1)
    notifications = add(notifications, { variant: 'warn', title: 'warning', source: 'system' }, 2)
    notifications = add(notifications, { variant: 'success', title: 'done', source: 'system' }, 3)

    expect(notifications.map((notification) => notification.autoDismissMs)).toEqual([null, 8_000, 4_000])
  })

  it('honors an explicit persistent duration for non-error notifications', () => {
    const notifications = add([], { variant: 'success', title: 'keep this', source: 'system', autoDismissMs: null }, 1)

    expect(notifications[0].autoDismissMs).toBeNull()
  })

  it('merges repeated keys, refreshes their content and moves them to the end', () => {
    let notifications = add([], error('first', 'connection:c1'), 1)
    notifications = add(notifications, error('other'), 2)
    notifications = add(notifications, { ...error('latest', 'connection:c1'), detail: 'socket closed' }, 3)

    expect(notifications).toHaveLength(2)
    expect(notifications[1]).toMatchObject({
      id: 'n-1',
      title: 'latest',
      detail: 'socket closed',
      repeatCount: 2,
      updatedAt: 3
    })
  })

  it('shows only the newest three and reveals older entries after dismissal', () => {
    let notifications: AppNotification[] = []
    for (let index = 1; index <= 4; index += 1) {
      notifications = add(notifications, error(`error ${index}`), index)
    }

    expect(visibleNotifications(notifications).map((notification) => notification.title)).toEqual([
      'error 2',
      'error 3',
      'error 4'
    ])
    notifications = dismissNotification(notifications, 'n-4')
    expect(visibleNotifications(notifications).map((notification) => notification.title)).toEqual([
      'error 1',
      'error 2',
      'error 3'
    ])
  })

  it('caps the queue and evicts transient notifications before persistent errors', () => {
    let notifications: AppNotification[] = []
    notifications = add(notifications, { variant: 'info', title: 'transient', source: 'system' }, 0)
    for (let index = 1; index <= MAX_NOTIFICATIONS; index += 1) {
      notifications = add(notifications, error(`error ${index}`), index)
    }

    expect(notifications).toHaveLength(MAX_NOTIFICATIONS)
    expect(notifications.some((notification) => notification.title === 'transient')).toBe(false)
    expect(notifications[0].title).toBe('error 1')
  })
})
