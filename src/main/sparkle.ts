import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

interface SparkleAddon {
  start(): void
  checkForUpdates(): void
}

function loadSparkleAddon(): SparkleAddon | null {
  if (process.platform !== 'darwin' || !app.isPackaged) return null

  const addonPath = join(process.resourcesPath, 'native', 'sparkle.node')
  if (!existsSync(addonPath)) {
    console.warn(`[sparkle] native addon not found: ${addonPath}`)
    return null
  }

  try {
    return require(addonPath) as SparkleAddon
  } catch (error) {
    console.error('[sparkle] failed to load updater', error)
    return null
  }
}

/** Start Sparkle only in packaged macOS builds; other targets stay untouched. */
export function startSparkle(): void {
  const addon = loadSparkleAddon()
  if (!addon) return

  try {
    addon.start()
  } catch (error) {
    console.error('[sparkle] failed to start updater', error)
  }
}

/** Trigger Sparkle's native update UI from a renderer action. */
export function checkSparkleForUpdates(): boolean {
  const addon = loadSparkleAddon()
  if (!addon) return false

  try {
    addon.checkForUpdates()
    return true
  } catch (error) {
    console.error('[sparkle] failed to check for updates', error)
    return false
  }
}
