import { describe, expect, it } from 'vitest'
import { scheduledReminderVersion } from '../../../src/main/updatesCore'

describe('scheduledReminderVersion', () => {
  it('shows a new version while automatic checks are enabled', () => {
    expect(scheduledReminderVersion('26.8.11', true, null)).toBe('26.8.11')
  })

  it('suppresses a version the user already opened', () => {
    expect(scheduledReminderVersion('26.8.11', true, '26.8.11')).toBeNull()
  })

  it('still shows a later version and suppresses reminders when checks are disabled', () => {
    expect(scheduledReminderVersion('26.8.12', true, '26.8.11')).toBe('26.8.12')
    expect(scheduledReminderVersion('26.8.12', false, '26.8.11')).toBeNull()
  })
})
