import { describe, expect, it } from 'vitest'
import { formatQueryTime } from '../../../src/renderer/src/lib/queryTime'

const DAY = 24 * 60 * 60 * 1000

describe('formatQueryTime', () => {
  const now = new Date(2026, 7, 13, 12, 30).getTime()

  it('uses hour and minute within the first day', () => {
    const recent = new Date(2026, 7, 13, 9, 5).getTime()
    expect(formatQueryTime(recent, 'zh-CN', now)).toBe('09:05')
  })

  it('switches to localized relative time after one day', () => {
    expect(formatQueryTime(now - DAY * 2, 'en', now)).toBe('2 days ago')
    expect(formatQueryTime(now - DAY * 2, 'zh-CN', now)).toBe('2 天前')
  })

  it('keeps clock time at exactly one day', () => {
    expect(formatQueryTime(now - DAY, 'en', now)).toBe('12:30')
  })
})
