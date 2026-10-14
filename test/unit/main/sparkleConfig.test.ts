import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Sparkle packaging configuration', () => {
  const config = readFileSync(resolve(process.cwd(), 'electron-builder.yml'), 'utf8')
  const nativeBridge = readFileSync(resolve(process.cwd(), 'native/sparkle.mm'), 'utf8')
  const mainBridge = readFileSync(resolve(process.cwd(), 'src/main/sparkle.ts'), 'utf8')
  const appcastScript = readFileSync(
    resolve(process.cwd(), 'scripts/generate-sparkle-appcast.mjs'),
    'utf8'
  )

  it('keeps scheduled checks enabled without silently installing on quit', () => {
    expect(config).toMatch(/^\s+SUEnableAutomaticChecks:\s+true\s*$/m)
    expect(config).toMatch(/^\s+SUAutomaticallyUpdate:\s+false\s*$/m)
  })

  it('checks for updates every six hours', () => {
    expect(config).toMatch(/^\s+SUScheduledCheckInterval:\s+21600\s*$/m)
  })

  it('uses Sparkle gentle reminders instead of showing scheduled update windows', () => {
    expect(nativeBridge).toContain('supportsGentleScheduledUpdateReminders')
    expect(nativeBridge).toMatch(/standardUserDriverShouldHandleShowingScheduledUpdate[\s\S]*return NO;/)
    expect(nativeBridge).toContain('state.userInitiated')
  })

  it('starts a fresh update session when the user opens a scheduled reminder', () => {
    expect(nativeBridge).toMatch(
      /static napi_value recheckForUpdates[\s\S]*updaterController = nil;[\s\S]*createUpdaterController\(\);[\s\S]*\[updaterController checkForUpdates:nil\]/
    )
    expect(mainBridge).toMatch(/showAvailableSparkleUpdate[\s\S]*addon\.recheckForUpdates\(\)/)
  })

  it('generates deltas from the three latest architecture-compatible archives', () => {
    expect(appcastScript).toContain('const maximumDeltas = 3')
    expect(appcastScript).toContain('String(maximumDeltas)')
    expect(appcastScript).toContain('`-${arch}.delta`')
  })

  it('publishes blockmap metadata for Windows and Linux', () => {
    expect(config).toMatch(/^\s+differentialPackage:\s+true\s*$/m)
    expect(config).toMatch(/^\s+artifactName:\s+\$\{productName\}\.Setup\.\$\{version\}\.\$\{ext\}\s*$/m)
    expect(config.match(/^\s+- provider:\s+github\s*$/gm)).toHaveLength(2)
    expect(config.match(/^\s+owner:\s+rrbe\s*$/gm)).toHaveLength(2)
    expect(config.match(/^\s+repo:\s+AMDM\s*$/gm)).toHaveLength(2)
  })
})
