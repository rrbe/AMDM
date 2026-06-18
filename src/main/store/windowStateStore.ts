import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { WindowBounds } from './windowStateCore'

interface WindowStateFile {
  version: 1
  /** Last *normal* (un-maximized) bounds; null until the user resizes once. */
  bounds: WindowBounds | null
  /** Re-maximize on next launch if the window was maximized at close. */
  isMaximized: boolean
}

/**
 * Persists the main window's geometry to window-state.json in userData (see
 * ADR-0006: plain JSON, no SQLite). Kept out of settings.json on purpose:
 * window bounds are main-process-only, change on every drag, and never cross
 * IPC — folding them into the renderer-facing settings would churn that file.
 */
class WindowStateStore {
  private filePath = ''
  private data: WindowStateFile = { version: 1, bounds: null, isMaximized: false }

  init(): void {
    this.filePath = join(app.getPath('userData'), 'window-state.json')
    if (existsSync(this.filePath)) {
      try {
        const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<WindowStateFile>
        this.data = {
          version: 1,
          bounds: parsed.bounds ?? null,
          isMaximized: parsed.isMaximized ?? false
        }
      } catch {
        // Corrupt file → fall back to defaults (window state is non-critical).
      }
    }
  }

  get(): WindowStateFile {
    return this.data
  }

  save(state: { bounds: WindowBounds; isMaximized: boolean }): void {
    this.data = { version: 1, bounds: state.bounds, isMaximized: state.isMaximized }
    try {
      writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8')
    } catch {
      // Best-effort: a failed write just means we restore the default size next
      // launch — never worth crashing or blocking quit over.
    }
  }
}

export const windowStateStore = new WindowStateStore()
