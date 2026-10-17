import type { AppSettings } from '@shared/types'

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
  const name = parts.get('timeZoneName')!
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
  const year = isoYear(parts.get('year')!, parts.get('era'))
  const month = parts.get('month')!
  const day = parts.get('day')!
  const hour = parts.get('hour')!
  const minute = parts.get('minute')!
  const second = parts.get('second')!
  const milliseconds = String(date.getUTCMilliseconds()).padStart(3, '0')
  return `${year}-${month}-${day}T${hour}:${minute}:${second}.${milliseconds}${offsetFromParts(parts)}`
}

export function getSystemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

export function getTimeZoneDetails(timeZone: string, date: Date, locale = 'en'): {
  offset: string
  offsetMinutes: number
  name: string
  label: string
} {
  const numericOffset = offsetFromParts(partsFor(date, timeZone))
  const [hours, minutes, seconds = 0] = numericOffset.slice(1).split(':').map(Number)
  const zoneName = (language: string): string => new Intl.DateTimeFormat(language, { timeZone, timeZoneName: 'long' })
    .formatToParts(date).find((part) => part.type === 'timeZoneName')!.value
  const name = zoneName(locale)
  const offset = `UTC${numericOffset}`
  // Classify the English ICU name independently of the display language.
  const englishName = locale.startsWith('en') ? name : zoneName('en')
  const detail = /\b(?:Daylight|Summer) Time\b/.test(englishName) ? `${offset} · ${name}` : offset
  return {
    offset,
    offsetMinutes: (numericOffset[0] === '-' ? -1 : 1) * (hours * 60 + minutes + seconds / 60),
    name,
    label: `${timeZone} (${detail})`
  }
}

export function formatTimeZoneLabel(timeZone: string, date: Date, locale = 'en'): string {
  return getTimeZoneDetails(timeZone, date, locale).label
}

export function resolveResultTimeZone(dateTimeZone: AppSettings['dateTimeZone']): string {
  return dateTimeZone === 'system' ? getSystemTimeZone() : dateTimeZone
}
