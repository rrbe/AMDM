import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Sparkle packaging configuration', () => {
  const config = readFileSync(resolve(process.cwd(), 'electron-builder.yml'), 'utf8')

  it('shows scheduled updates instead of silently installing them on quit', () => {
    expect(config).toMatch(/^\s+SUEnableAutomaticChecks:\s+true\s*$/m)
    expect(config).toMatch(/^\s+SUAutomaticallyUpdate:\s+false\s*$/m)
  })
})
