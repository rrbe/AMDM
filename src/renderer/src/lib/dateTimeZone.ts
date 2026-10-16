import type { AppSettings } from '@shared/types'
import type { ClipboardEvent as ReactClipboardEvent } from 'react'

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone)
  if (cached) {
    formatters.delete(timeZone)
    formatters.set(timeZone, cached)
    return cached
  }

  const formatter = new Intl.DateTimeFormat('en-u-ca-iso8601-nu-latn', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    era: 'short',
    timeZoneName: 'longOffset'
  })
  formatters.set(timeZone, formatter)
  if (formatters.size > 8) formatters.delete(formatters.keys().next().value!)
  return formatter
}

function partsFor(date: Date, timeZone: string): Map<string, string> {
  return new Map(formatterFor(timeZone).formatToParts(date).map((part) => [part.type, part.value]))
}

function offsetFromParts(parts: Map<string, string>): string {
  const name = parts.get('timeZoneName') ?? 'GMT'
  const match = /^(?:GMT|UTC)(?:([+-])(\d{2}):(\d{2})(?::(\d{2}))?)?$/i.exec(name)
  if (!match) throw new RangeError(`Unsupported time zone offset: ${name}`)
  if (!match[1]) return '+00:00'
  return `${match[1]}${match[2]}:${match[3]}${match[4] ? `:${match[4]}` : ''}`
}

function isoYear(year: string, era: string | undefined): string {
  const numericYear = Number(year)
  const signedYear = era?.toLowerCase().startsWith('b') ? 1 - numericYear : numericYear
  if (signedYear >= 0 && signedYear <= 9999) return String(signedYear).padStart(4, '0')
  return `${signedYear < 0 ? '-' : '+'}${String(Math.abs(signedYear)).padStart(6, '0')}`
}

/** Render one instant as an ISO wall time with that zone's numeric offset. */
export function formatDateInTimeZone(date: Date, timeZone: string): string {
  const parts = partsFor(date, timeZone)
  const year = isoYear(parts.get('year') ?? '0', parts.get('era'))
  const month = parts.get('month') ?? '01'
  const day = parts.get('day') ?? '01'
  const hour = parts.get('hour') ?? '00'
  const minute = parts.get('minute') ?? '00'
  const second = parts.get('second') ?? '00'
  const milliseconds = String(date.getUTCMilliseconds()).padStart(3, '0')
  return `${year}-${month}-${day}T${hour}:${minute}:${second}.${milliseconds}${offsetFromParts(parts)}`
}

export function formatTimeZoneOffset(date: Date, timeZone: string): string {
  return `UTC${offsetFromParts(partsFor(date, timeZone))}`
}

export function getSystemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

export function resolveResultTimeZone(
  dateTimeZone: AppSettings['dateTimeZone'],
  connectionDateTimeZones: AppSettings['connectionDateTimeZones'],
  connectionId?: string | null
): string {
  const selected = (connectionId && connectionDateTimeZones[connectionId]) || dateTimeZone
  return selected === 'system' ? getSystemTimeZone() : selected
}

export function formatResultTimeZoneLabel(timeZone: string): string {
  return `${timeZone} (${formatTimeZoneOffset(new Date(), timeZone)})`
}

/** Keep native selections from JSON/Console in the UTC form used by explicit copy actions. */
export function normalizeDisplayDatesForCopy(text: string): string {
  return text.replace(/ISODate\("([^"\n]+)"\)/g, (token, value: string) => {
    const match = /^([+-]?\d{4,6})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})([+-])(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value)
    if (!match) return token
    const [, year, month, day, hour, minute, second, millisecond, sign, offsetHour, offsetMinute, offsetSecond = '0'] = match
    const date = new Date(0)
    date.setUTCFullYear(Number(year), Number(month) - 1, Number(day))
    date.setUTCHours(Number(hour), Number(minute), Number(second), Number(millisecond))
    const offset = (Number(offsetHour) * 3600 + Number(offsetMinute) * 60 + Number(offsetSecond)) * 1000
    const utc = date.getTime() - (sign === '+' ? offset : -offset)
    const utcDate = new Date(utc)
    return Number.isNaN(utcDate.getTime()) ? token : `ISODate("${utcDate.toISOString()}")`
  })
}

export function copyDisplayDatesAsUtc(event: ReactClipboardEvent<HTMLDivElement>): void {
  const selected = window.getSelection()
  if (!selected || selected.isCollapsed) return
  event.clipboardData.setData('text/plain', normalizeDisplayDatesForCopy(selected.toString()))
  event.preventDefault()
}
