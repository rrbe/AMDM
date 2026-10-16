import { describe, expect, it } from 'vitest'
import { formatDateInTimeZone, formatTimeZoneOffset, normalizeDisplayDatesForCopy } from '@renderer/lib/dateTimeZone'

describe('date time zone display', () => {
  it('formats an instant with the local wall time and numeric offset', () => {
    const date = new Date('2026-10-15T09:50:05.154Z')
    expect(formatDateInTimeZone(date, 'Asia/Shanghai')).toBe('2026-10-15T17:50:05.154+08:00')
    expect(formatTimeZoneOffset(date, 'Asia/Shanghai')).toBe('UTC+08:00')
  })

  it('converts copied displayed ISODate values back to UTC', () => {
    expect(normalizeDisplayDatesForCopy('ISODate("2026-10-15T17:50:05.154+08:00")'))
      .toBe('ISODate("2026-10-15T09:50:05.154Z")')
    expect(normalizeDisplayDatesForCopy('ISODate("1900-01-01T05:53:28.000+05:53:28")'))
      .toBe('ISODate("1900-01-01T00:00:00.000Z")')
  })
})
