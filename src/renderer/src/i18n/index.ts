/**
 * i18next bootstrap for the renderer. Resources are tiny static JSON (one file
 * per locale) so they're inlined at build time — no lazy loading needed, in
 * keeping with the perf rules (the whole catalog is a few KB).
 *
 * The persisted preference lives in AppSettings.language ('system' | locale).
 * `setLanguage` maps it (plus the OS locales) onto a shipped locale and applies
 * it; App.tsx calls it whenever the setting changes.
 */
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import type { Language } from '@shared/types'
import { DEFAULT_LOCALE, osLocales, resolveLanguage } from '@renderer/lib/language'
import en from './locales/en.json'
import zhCN from './locales/zh-CN.json'
import zhTW from './locales/zh-TW.json'

export const resources = {
  en: { translation: en },
  'zh-CN': { translation: zhCN },
  'zh-TW': { translation: zhTW }
} as const

void i18n.use(initReactI18next).init({
  resources,
  lng: DEFAULT_LOCALE,
  fallbackLng: DEFAULT_LOCALE,
  interpolation: { escapeValue: false }, // React already escapes
  returnNull: false
})

/** Apply a persisted language preference (resolving 'system' to a real locale). */
export function setLanguage(setting: Language): void {
  const locale = resolveLanguage(setting, osLocales())
  if (i18n.language !== locale) void i18n.changeLanguage(locale)
  document.documentElement.setAttribute('lang', locale)
}

export default i18n
