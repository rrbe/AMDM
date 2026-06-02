import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { DEFAULT_SETTINGS, type AppSettings } from '../../shared/types'

interface SettingsFile {
  version: 1
  settings: AppSettings
}

/** Persists UI preferences to settings.json in userData (see ADR-0006). */
class SettingsStore {
  private filePath = ''
  private data: SettingsFile = { version: 1, settings: { ...DEFAULT_SETTINGS } }

  init(): void {
    this.filePath = join(app.getPath('userData'), 'settings.json')
    if (existsSync(this.filePath)) {
      try {
        const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<SettingsFile>
        // Merge over defaults so new settings keys get sane values on upgrade.
        this.data = { version: 1, settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) } }
      } catch {
        this.data = { version: 1, settings: { ...DEFAULT_SETTINGS } }
      }
    }
  }

  private persist(): void {
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8')
  }

  get(): AppSettings {
    return this.data.settings
  }

  update(patch: Partial<AppSettings>): AppSettings {
    this.data.settings = { ...this.data.settings, ...patch }
    this.persist()
    return this.data.settings
  }
}

export const settingsStore = new SettingsStore()
