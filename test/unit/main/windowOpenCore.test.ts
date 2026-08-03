import { describe, expect, it } from 'vitest'
import { isSettingsWindowUrl } from '../../../src/main/windowOpenCore'

describe('isSettingsWindowUrl', () => {
  it('allows only the settings hash on the current renderer page', () => {
    const current = 'file:///Applications/AMDM.app/Contents/Resources/app.asar/out/renderer/index.html'

    expect(isSettingsWindowUrl(`${current}#settings`, current)).toBe(true)
    expect(isSettingsWindowUrl(`${current}#other`, current)).toBe(false)
    expect(isSettingsWindowUrl('https://example.com/#settings', current)).toBe(false)
  })
})
