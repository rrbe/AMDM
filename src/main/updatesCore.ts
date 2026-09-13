/** Decide whether a scheduled Sparkle result should become a visible reminder. */
export function scheduledReminderVersion(
  version: string,
  automaticallyChecksForUpdates: boolean,
  acknowledgedVersion: string | null
): string | null {
  if (!automaticallyChecksForUpdates || version === acknowledgedVersion) return null
  return version
}
import { resolveLanguage } from '../shared/language'
import type { Language } from '../shared/types'

export function sparkleFeedURL(language: Language, systemLanguages: readonly string[], arch: string): string {
  const locale = resolveLanguage(language, systemLanguages)
  const suffix = locale === 'en' ? '' : '-cn'
  return `https://github.com/rrbe/AMDM/releases/latest/download/appcast-${arch}${suffix}.xml`
}
