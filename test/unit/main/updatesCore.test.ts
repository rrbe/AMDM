import { describe, expect, it } from 'vitest'
import { scheduledReminderVersion, sparkleFeedURL } from '../../../src/main/updatesCore'

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


describe('Sparkle language selection', () => {
  it.each(['arm64', 'x64'])('uses the app language over system preferences for %s', (arch) => {
    expect(sparkleFeedURL('en', ['zh-CN'], arch)).toMatch(`/appcast-${arch}.xml`)
    expect(sparkleFeedURL('zh-CN', ['en-US'], arch)).toMatch(`/appcast-${arch}-cn.xml`)
    expect(sparkleFeedURL('zh-TW', ['en-US'], arch)).toMatch(`/appcast-${arch}-cn.xml`)
  })

  it('resolves system languages in the same preference order as the renderer', () => {
    expect(sparkleFeedURL('system', ['fr', 'zh-Hant-HK', 'en'], 'arm64')).toMatch('/appcast-arm64-cn.xml')
    expect(sparkleFeedURL('system', ['en-GB', 'zh-CN'], 'x64')).toMatch('/appcast-x64.xml')
    expect(sparkleFeedURL('system', ['fr'], 'arm64')).toMatch('/appcast-arm64.xml')
  })
})
