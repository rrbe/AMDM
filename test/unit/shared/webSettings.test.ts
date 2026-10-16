import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../../src/shared/types'
import { mergeWebSettings } from '../../../src/shared/webSettings'

describe('mergeWebSettings time zones', () => {
  it('accepts IANA zones for the app and per-connection settings', () => {
    expect(mergeWebSettings(DEFAULT_SETTINGS, {
      dateTimeZone: 'Asia/Shanghai',
      connectionDateTimeZones: { connection1: 'America/Los_Angeles' }
    })).toMatchObject({
      dateTimeZone: 'Asia/Shanghai',
      connectionDateTimeZones: { connection1: 'America/Los_Angeles' }
    })
  })

  it('rejects unknown zones and fixed offsets', () => {
    expect(() => mergeWebSettings(DEFAULT_SETTINGS, { dateTimeZone: 'Not/AZone' })).toThrow('Invalid settings patch.')
    expect(() => mergeWebSettings(DEFAULT_SETTINGS, { dateTimeZone: '+08:00' })).toThrow('Invalid settings patch.')
    expect(() => mergeWebSettings(DEFAULT_SETTINGS, { dateTimeZone: 'UTC+08:00' })).toThrow('Invalid settings patch.')
    expect(() => mergeWebSettings(DEFAULT_SETTINGS, { dateTimeZone: 'Etc/GMT+8' })).toThrow('Invalid settings patch.')
    expect(() => mergeWebSettings(DEFAULT_SETTINGS, {
      connectionDateTimeZones: { connection1: 'GMT+8' }
    })).toThrow('Invalid settings patch.')
  })
})
