import { describe, expect, it } from 'vitest'
import { isValidTimeZone } from '@shared/timeZones'
import { createTimeZoneChoices, matchesTimeZoneSearch } from '@renderer/lib/timeZoneOptions'

const winter = new Date('2026-01-15T12:00:00Z')
const summer = new Date('2026-07-15T12:00:00Z')
const choices = createTimeZoneChoices(winter, 'zh-CN', 'Asia/Shanghai')
const matches = (query: string) => choices.filter((choice) => matchesTimeZoneSearch(choice, query))

describe('time zone choices', () => {
  it('keeps system first, values unique and every value persistable', () => {
    expect(choices[0]).toMatchObject({ value: 'system', offsetMinutes: 480 })
    expect(new Set(choices.map((choice) => choice.value)).size).toBe(choices.length)
    expect(choices.slice(1).every((choice) => isValidTimeZone(choice.value))).toBe(true)
  })

  it.each(['Beijing', '北京', 'Guangzhou', '广州', '廣州', 'Shenzhen', '上海', 'China', '中国', 'Asia/Shanghai'])(
    'finds Shanghai by %s', (query) => {
      expect(matches(query).map((choice) => choice.value)).toContain('Asia/Shanghai')
    }
  )

  it.each([
    ['San Francisco', 'America/Los_Angeles'], ['旧金山', 'America/Los_Angeles'],
    ['紐約', 'America/New_York'], ['London', 'Europe/London'], ['东京', 'Asia/Tokyo'],
    ['sao paulo', 'America/Sao_Paulo'], ['Hanoi', 'Asia/Ho_Chi_Minh']
  ])('finds %s through city metadata', (query, value) => {
    const runtimeName = new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone
    expect(matches(query).map((choice) => choice.value)).toContain(runtimeName)
  })

  it.each(['utc+8', 'UTC +08:00', '+8', '+0800', 'gmt+8'])('matches positive offsets for %s', (query) => {
    const found = matches(query)
    expect(found.map((choice) => choice.value)).toEqual(expect.arrayContaining(['Asia/Shanghai', 'Asia/Singapore']))
    expect(found.every((choice) => choice.offsetMinutes === 480)).toBe(true)
  })

  it('matches either sign for an unsigned hour', () => {
    expect(matches('8').map((choice) => choice.value)).toEqual(expect.arrayContaining(['Asia/Shanghai', 'America/Los_Angeles']))
    expect(matches('-8').every((choice) => choice.offsetMinutes === -480)).toBe(true)
  })

  it('keeps a city attached to its representative region instead of all regions sharing its clock', () => {
    const found = matches('New York').map((choice) => choice.value)
    expect(found).toContain('America/New_York')
    expect(found).not.toContain('America/Detroit')
    expect(matches('Detroit').map((choice) => choice.value)).toContain('America/Detroit')
  })

  it.each(['losangeles', 'los_angeles', 'los angeles', 'Los-Angeles', 'america/losangeles'])(
    'matches %s independently of separators', (query) => {
      expect(matches(query).map((choice) => choice.value)).toContain('America/Los_Angeles')
    }
  )

  it('supports half-hour and quarter-hour offsets without loose number matching', () => {
    const kolkata = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Kolkata' }).resolvedOptions().timeZone
    expect(matches('+5:30').map((choice) => choice.value)).toContain(kolkata)
    const kathmandu = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Kathmandu' }).resolvedOptions().timeZone
    expect(matches('UTC+05:45').map((choice) => choice.value)).toContain(kathmandu)
    expect(matches('+8:80')).toEqual([])
    expect(matches('+24')).toEqual([])
    expect(matches('not a city or zone')).toEqual([])
  })

  it('matches the date-specific regional offset through daylight saving changes', () => {
    const july = createTimeZoneChoices(summer, 'en', 'America/New_York')
    expect(choices.find((choice) => choice.value === 'America/New_York')?.offsetMinutes).toBe(-300)
    expect(july.find((choice) => choice.value === 'America/New_York')?.offsetMinutes).toBe(-240)
    const newYork = july.find((choice) => choice.value === 'America/New_York')!
    expect(matchesTimeZoneSearch(newYork, '-4')).toBe(true)
    expect(matchesTimeZoneSearch(newYork, '-5')).toBe(false)
  })

  it('keeps localized zone labels and city search independent', () => {
    expect(choices.find((choice) => choice.value === 'Asia/Shanghai')?.label).toBe('Asia/Shanghai (UTC+08:00)')
    const traditional = createTimeZoneChoices(winter, 'zh-TW', 'Asia/Shanghai')
    expect(matchesTimeZoneSearch(traditional.find((choice) => choice.value === 'Asia/Shanghai')!, '廣州')).toBe(true)
    const english = createTimeZoneChoices(winter, 'en', 'Asia/Shanghai')
    expect(matchesTimeZoneSearch(english.find((choice) => choice.value === 'Asia/Shanghai')!, 'Beijing')).toBe(true)
  })
})
