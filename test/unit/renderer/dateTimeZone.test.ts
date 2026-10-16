import { describe, expect, it } from 'vitest'
import { formatDateInTimeZone, formatTimeZoneLabel, resolveResultTimeZone } from '@renderer/lib/dateTimeZone'

describe('date time zone display', () => {
  it.each([
    ['2026-10-15T09:50:05.154Z', 'Asia/Shanghai', '2026-10-15T17:50:05.154+08:00'],
    ['2026-01-01T00:00:00.001Z', 'America/Los_Angeles', '2025-12-31T16:00:00.001-08:00'],
    ['2026-07-01T12:00:00.000Z', 'America/Los_Angeles', '2026-07-01T05:00:00.000-07:00'],
    ['2026-03-08T09:59:59.999Z', 'America/Los_Angeles', '2026-03-08T01:59:59.999-08:00'],
    ['2026-03-08T10:00:00.000Z', 'America/Los_Angeles', '2026-03-08T03:00:00.000-07:00'],
    ['2026-01-01T00:00:00.000Z', 'Asia/Kathmandu', '2026-01-01T05:45:00.000+05:45'],
    ['1900-01-01T00:00:00.000Z', 'Asia/Kolkata', '1900-01-01T05:21:10.000+05:21:10'],
    ['0000-01-01T00:00:00.000Z', 'UTC', '0000-01-01T00:00:00.000+00:00'],
    ['+010000-01-01T00:00:00.000Z', 'UTC', '+010000-01-01T00:00:00.000+00:00']
  ])('formats %s in %s', (instant, zone, expected) => {
    expect(formatDateInTimeZone(new Date(instant), zone)).toBe(expected)
  })

  it('resolves the app display preference', () => {
    expect(resolveResultTimeZone('Asia/Shanghai')).toBe('Asia/Shanghai')
    expect(resolveResultTimeZone('UTC')).toBe('UTC')
    expect(resolveResultTimeZone('system')).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
  })

  it.each([
    ['America/Los_Angeles', '2026-07-01', 'UTC-07:00', '夏令时间'],
    ['America/Los_Angeles', '2026-01-01', 'UTC-08:00', '标准时间'],
    ['Australia/Sydney', '2026-07-01', 'UTC+10:00', '标准时间'],
    ['Australia/Sydney', '2026-01-01', 'UTC+11:00', '夏令时间'],
    ['Europe/Dublin', '2026-07-01', 'UTC+01:00', '爱尔兰标准时间'],
    ['Asia/Shanghai', '2026-07-01', 'UTC+08:00', '中国标准时间']
  ])('labels %s at %s using its actual seasonal name', (zone, date, offset, name) => {
    const label = formatTimeZoneLabel(zone, new Date(date), 'zh-CN')
    expect(label).toContain(offset)
    expect(label).toContain(name)
  })

  it('localizes seasonal names and keeps UTC concise', () => {
    const date = new Date('2026-07-01')
    expect(formatTimeZoneLabel('America/Los_Angeles', date, 'en')).toContain('Pacific Daylight Time')
    expect(formatTimeZoneLabel('UTC', date, 'zh-CN')).toBe('UTC (UTC+00:00)')
  })
})
