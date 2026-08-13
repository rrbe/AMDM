import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Sparkle packaging configuration', () => {
  const config = readFileSync(resolve(process.cwd(), 'electron-builder.yml'), 'utf8')
  const nativeBridge = readFileSync(resolve(process.cwd(), 'native/sparkle.mm'), 'utf8')

  it('keeps scheduled checks enabled without silently installing on quit', () => {
    expect(config).toMatch(/^\s+SUEnableAutomaticChecks:\s+true\s*$/m)
    expect(config).toMatch(/^\s+SUAutomaticallyUpdate:\s+false\s*$/m)
  })

  it('uses Sparkle gentle reminders instead of showing scheduled update windows', () => {
    expect(nativeBridge).toContain('supportsGentleScheduledUpdateReminders')
    expect(nativeBridge).toMatch(/standardUserDriverShouldHandleShowingScheduledUpdate[\s\S]*return NO;/)
    expect(nativeBridge).toContain('state.userInitiated')
  })
})
