import { describe, expect, it } from 'vitest'
import { matchesSettingsSearch } from '@renderer/lib/settingsSearch'

describe('matchesSettingsSearch', () => {
  it('matches localized setting labels case-insensitively', () => {
    expect(matchesSettingsSearch(['Appearance', 'Theme', '语言'], 'theme')).toBe(true)
    expect(matchesSettingsSearch(['Appearance', 'Theme', '语言'], ' 语言 ')).toBe(true)
    expect(matchesSettingsSearch(['Appearance', 'Theme', '语言'], 'updates')).toBe(false)
  })
})
