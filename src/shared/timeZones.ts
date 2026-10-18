const intl = Intl as typeof Intl & { supportedValuesOf: (key: 'timeZone') => string[] }
export const IANA_TIME_ZONES: readonly string[] = Object.freeze(
  [...new Set([...intl.supportedValuesOf('timeZone'), 'UTC'])].sort()
)
const SUPPORTED_TIME_ZONES = new Set(IANA_TIME_ZONES)

/** Return whether a value is one of the canonical region zones offered by the UI. */
export function isValidTimeZone(value: unknown): value is string {
  return typeof value === 'string' && SUPPORTED_TIME_ZONES.has(value)
}
