export { DEFAULT_LOCALE, SUPPORTED_LOCALES, resolveLanguage } from '@shared/language'
export type { Locale } from '@shared/language'

/** The browser/OS locale list, most-preferred first (renderer only). */
export function osLocales(): readonly string[] {
  if (typeof navigator === 'undefined') return []
  return navigator.languages?.length ? navigator.languages : [navigator.language]
}
