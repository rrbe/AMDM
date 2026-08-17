import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { UpdateState } from '../shared/types'
import { settingsStore } from './store/settingsStore'
import { scheduledReminderVersion } from './updatesCore'

interface SparkleAddon {
  start(onScheduledUpdate: (version: string) => void): void
  checkForUpdates(): void
  recheckForUpdates(): void
  getAutomaticallyChecksForUpdates(): boolean
  setAutomaticallyChecksForUpdates(enabled: boolean): void
}

const stateListeners = new Set<(state: UpdateState) => void>()
let pendingVersion: string | null = null

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
    addon.start((version) => {
      pendingVersion = scheduledReminderVersion(
        version,
        addon.getAutomaticallyChecksForUpdates(),
        settingsStore.get().acknowledgedUpdateVersion
      )
      emitState()
    })
  } catch (error) {
    console.error('[sparkle] failed to start updater', error)
  }
}

export function getSparkleState(): UpdateState {
  const addon = loadSparkleAddon()
  if (!addon) {
    return { available: false, automaticallyChecksForUpdates: false, availableVersion: null }
  }
  return {
    available: true,
    automaticallyChecksForUpdates: addon.getAutomaticallyChecksForUpdates(),
    availableVersion: pendingVersion
  }
}

function emitState(): void {
  const state = getSparkleState()
  for (const listener of stateListeners) listener(state)
}

export function onSparkleStateChanged(listener: (state: UpdateState) => void): () => void {
  stateListeners.add(listener)
  return () => stateListeners.delete(listener)
}

export function setSparkleAutomaticChecks(enabled: boolean): UpdateState {
  const addon = loadSparkleAddon()
  if (!addon) return getSparkleState()
  addon.setAutomaticallyChecksForUpdates(enabled)
  if (!enabled) pendingVersion = null
  emitState()
  return getSparkleState()
}

export function showAvailableSparkleUpdate(): boolean {
  const addon = loadSparkleAddon()
  if (!addon) return false
  if (pendingVersion) settingsStore.update({ acknowledgedUpdateVersion: pendingVersion })
  pendingVersion = null
  emitState()
  addon.recheckForUpdates()
  return true
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
