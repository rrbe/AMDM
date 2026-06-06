/**
 * Pure language-resolution helpers (no React, no i18next) so they can be unit
 * tested. The renderer maps the persisted `Language` preference plus the live
 * browser/OS locales onto one of the locales we actually ship.
 */
import type { Language } from '@shared/types'

/** The concrete locales bundled with the app (no 'system'). */
export const SUPPORTED_LOCALES = ['en', 'zh-CN', 'zh-TW'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'en'

/** Map a single BCP-47 tag (e.g. "zh-Hant-HK", "en-US") to a shipped locale. */
function matchLocale(tag: string): Locale | null {
  const lc = tag.toLowerCase()
  if (lc.startsWith('zh')) {
    // Traditional Chinese regions / script subtags pin zh-TW; everything else
    // (zh, zh-CN, zh-Hans, zh-SG) falls to Simplified.
    if (/\b(hant|tw|hk|mo)\b/.test(lc)) return 'zh-TW'
    return 'zh-CN'
  }
  if (lc.startsWith('en')) return 'en'
  return null
}

/**
 * Resolve the effective UI locale.
 *
 * - A pinned preference ('en' | 'zh-CN' | 'zh-TW') is returned as-is.
 * - 'system' walks the provided OS/browser locales (most-preferred first) and
 *   returns the first that maps to a shipped locale, else DEFAULT_LOCALE.
 */
export function resolveLanguage(setting: Language, osLocales: readonly string[]): Locale {
  if (setting !== 'system') {
    return (SUPPORTED_LOCALES as readonly string[]).includes(setting)
      ? (setting as Locale)
      : DEFAULT_LOCALE
  }
  for (const tag of osLocales) {
    const hit = matchLocale(tag)
    if (hit) return hit
  }
  return DEFAULT_LOCALE
}

/** The browser/OS locale list, most-preferred first (renderer only). */
export function osLocales(): readonly string[] {
  if (typeof navigator === 'undefined') return []
  return navigator.languages?.length ? navigator.languages : [navigator.language]
}
