/**
 * i18n resource integrity + language resolution.
 *
 * The catalogue is hand-maintained across three locales; these tests are the
 * backstop that they stay in lock-step:
 *  - identical key sets (no missing / stray translations),
 *  - matching {{interpolation}} placeholders per key (a dropped var would throw
 *    at runtime or render a blank),
 *  - every plural `_one` has its `_other` partner,
 * plus the pure `resolveLanguage` mapping (preference + OS locales → locale).
 */
import { describe, it, expect } from 'vitest'
import en from '@renderer/i18n/locales/en.json'
import zhCN from '@renderer/i18n/locales/zh-CN.json'
import zhTW from '@renderer/i18n/locales/zh-TW.json'
import { resolveLanguage } from '@renderer/lib/language'

type Dict = { [k: string]: unknown }

/** Flatten a nested resource object to `dot.path -> string`. */
function flatten(obj: Dict, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object') Object.assign(out, flatten(v as Dict, prefix + k + '.'))
    else out[prefix + k] = String(v)
  }
  return out
}

const locales = { en, 'zh-CN': zhCN, 'zh-TW': zhTW } as Record<string, Dict>
const flat = Object.fromEntries(Object.entries(locales).map(([l, o]) => [l, flatten(o)]))
const placeholders = (s: string): string[] => (s.match(/{{\s*\w+\s*}}/g) ?? []).map((m) => m.replace(/\s/g, '')).sort()

describe('i18n resources', () => {
  const baseKeys = Object.keys(flat.en).sort()

  it('every locale has the exact same key set', () => {
    for (const l of ['zh-CN', 'zh-TW']) {
      expect(Object.keys(flat[l]).sort(), `${l} key set`).toEqual(baseKeys)
    }
  })

  it('placeholders match across locales for every key', () => {
    for (const key of baseKeys) {
      const want = placeholders(flat.en[key])
      for (const l of ['zh-CN', 'zh-TW']) {
        expect(placeholders(flat[l][key]), `${l} placeholders for "${key}"`).toEqual(want)
      }
    }
  })

  it('every plural _one key has a matching _other (and vice versa)', () => {
    for (const key of baseKeys) {
      if (key.endsWith('_one')) expect(baseKeys).toContain(key.slice(0, -4) + '_other')
      if (key.endsWith('_other')) expect(baseKeys).toContain(key.slice(0, -6) + '_one')
    }
  })

  it('no value is left blank', () => {
    for (const [l, dict] of Object.entries(flat)) {
      for (const [k, v] of Object.entries(dict)) expect(v.length, `${l}:${k}`).toBeGreaterThan(0)
    }
  })
})

describe('resolveLanguage', () => {
  it('returns a pinned preference verbatim', () => {
    expect(resolveLanguage('en', ['zh-CN'])).toBe('en')
    expect(resolveLanguage('zh-CN', [])).toBe('zh-CN')
    expect(resolveLanguage('zh-TW', ['en-US'])).toBe('zh-TW')
  })

  it("maps 'system' from the first matching OS locale", () => {
    expect(resolveLanguage('system', ['en-US'])).toBe('en')
    expect(resolveLanguage('system', ['zh-CN'])).toBe('zh-CN')
    expect(resolveLanguage('system', ['zh'])).toBe('zh-CN')
    expect(resolveLanguage('system', ['zh-SG'])).toBe('zh-CN')
  })

  it("pins Traditional regions / script subtags to zh-TW", () => {
    expect(resolveLanguage('system', ['zh-TW'])).toBe('zh-TW')
    expect(resolveLanguage('system', ['zh-Hant-HK'])).toBe('zh-TW')
    expect(resolveLanguage('system', ['zh-MO'])).toBe('zh-TW')
  })

  it('walks the list and falls back to English', () => {
    expect(resolveLanguage('system', ['fr-FR', 'zh-CN'])).toBe('zh-CN')
    expect(resolveLanguage('system', ['fr-FR'])).toBe('en')
    expect(resolveLanguage('system', [])).toBe('en')
  })
})
