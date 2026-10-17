import rawTimeZones from '@vvo/tzdb/raw-time-zones.json'
import { IANA_TIME_ZONES } from '@shared/timeZones'
import cityNames from './timeZoneCities.json'
import { getTimeZoneDetails } from './dateTimeZone'

export interface TimeZoneChoice {
  value: string
  label: string
  offsetMinutes: number
  searchText: string
}

const metadata = new Map(rawTimeZones.flatMap((zone) => zone.group.map((name) => [name, zone] as const)))
const supportedRegions = new Set(IANA_TIME_ZONES)
const representativeRegions = new Map(rawTimeZones.map((zone) => [
  zone.name, supportedRegions.has(zone.name) ? zone.name : zone.group.find((name) => supportedRegions.has(name))
]))
const translatedCities: Record<string, string[][]> = cityNames

function normalize(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase()
}

/** City metadata is searchable; the saved region still owns its date-specific rules. */
export function createTimeZoneChoices(date: Date, locale: string, systemTimeZone: string): TimeZoneChoice[] {
  const countries = new Intl.DisplayNames([locale], { type: 'region' })
  const regionChoice = (value: string): TimeZoneChoice => {
    const details = getTimeZoneDetails(value, date, locale)
    const zone = metadata.get(value)
    const representative = zone && representativeRegions.get(zone.name) === value
    const translations = representative ? translatedCities[zone.name] ?? [] : []
    const englishCities = [...new Set([...translations.map((names) => names[0]),
      ...(representative ? zone.mainCities : [value.split('/').at(-1)!.replaceAll('_', ' ')])])]
    return {
      value, label: details.label, offsetMinutes: details.offsetMinutes,
      searchText: [value, details.name, details.offset, zone?.alternativeName, zone?.countryName,
        zone && countries.of(zone.countryCode), ...englishCities, ...translations.flat()].filter(Boolean).join(' ')
    }
  }
  return [{ ...regionChoice(systemTimeZone), value: 'system' }, ...IANA_TIME_ZONES.map(regionChoice)]
}

/** Signed queries match that offset; an unsigned hour matches either sign. */
export function matchesTimeZoneSearch(choice: TimeZoneChoice, query: string): boolean {
  const offsetQuery = /^(?:utc|gmt)?([+-])?(\d{1,2})(?::?(\d{2}))?$/i.exec(query.replace(/\s/g, ''))
  if (offsetQuery) {
    const [, sign, hours, minuteText] = offsetQuery
    const minutes = Number(minuteText ?? 0)
    if (minutes >= 60) return false
    const magnitude = Number(hours) * 60 + minutes
    return sign ? choice.offsetMinutes === (sign === '-' ? -1 : 1) * magnitude : Math.abs(choice.offsetMinutes) === magnitude
  }
  return normalize(choice.searchText).includes(normalize(query))
}
