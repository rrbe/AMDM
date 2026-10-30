import { app } from 'electron'
import electronUpdater, { type CancellationToken } from 'electron-updater'
import type { UpdateState } from '../shared/types'
import { canUseElectronUpdater, nextElectronUpdateState } from './electronUpdaterCore'
import { settingsStore } from './store/settingsStore'
import { prepareAppQuit } from './appLifecycle'

const FIRST_CHECK_DELAY_MS = 30_000
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

const { autoUpdater } = electronUpdater
const stateListeners = new Set<(state: UpdateState) => void>()
let state: UpdateState = {
  available: false,
  automaticallyChecksForUpdates: false,
  phase: 'idle',
  availableVersion: null,
  downloadProgress: null
}
let started = false
let automaticTimer: ReturnType<typeof setTimeout> | null = null
let checkInFlight: Promise<boolean> | null = null
let downloadInFlight: Promise<boolean> | null = null
let downloadToken: CancellationToken | null = null
let installRequested = false
let installFailed = false

function finishFailedInstall(): void {
  installFailed = true
  installRequested = false
  // Cleanup has committed shutdown. Exit without retrying the failed installer on quit.
  autoUpdater.autoInstallOnAppQuit = false
  app.quit()
}

function updaterAvailable(): boolean {
  return canUseElectronUpdater(app.isPackaged, process.platform, process.env['APPIMAGE'])
}

function setState(patch: Partial<UpdateState>): void {
  state = { ...state, ...patch }
  for (const listener of stateListeners) listener(state)
}

function transition(event: Parameters<typeof nextElectronUpdateState>[1]): void {
  const next = nextElectronUpdateState(state, event)
  setState(next)
}

function scheduleAutomaticCheck(delay: number): void {
  if (automaticTimer) clearTimeout(automaticTimer)
  automaticTimer = null
  if (!state.available || !state.automaticallyChecksForUpdates) return

  automaticTimer = setTimeout(() => {
    automaticTimer = null
    void checkElectronForUpdates().catch((error) => {
      console.warn('[updater] automatic check failed', error)
    }).finally(() => scheduleAutomaticCheck(CHECK_INTERVAL_MS))
  }, delay)
  automaticTimer.unref()
}

export function startElectronUpdater(): void {
  if (started) return
  started = true

  const available = updaterAvailable()
  state = {
    available,
    automaticallyChecksForUpdates: available && settingsStore.get().automaticUpdateChecks,
    phase: 'idle',
    availableVersion: null,
    downloadProgress: null
  }
  if (!available) return

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = {
    info: (message) => console.log('[updater]', message),
    warn: (message) => console.warn('[updater]', message),
    error: (message) => console.error('[updater]', message)
  }

  autoUpdater.on('checking-for-update', () => transition({ type: 'checking' }))
  autoUpdater.on('update-available', (info) => transition({ type: 'available', version: info.version }))
  autoUpdater.on('update-not-available', () => transition({ type: 'not-available' }))
  autoUpdater.on('download-progress', (progress) => transition({ type: 'progress', progress }))
  autoUpdater.on('update-downloaded', (info) => {
    transition({ type: 'downloaded', version: info.version })
  })
  autoUpdater.on('update-cancelled', (info) => transition({ type: 'available', version: info.version }))
  autoUpdater.on('error', (error) => {
    console.error('[updater] operation failed', error)
    if (installRequested) finishFailedInstall()
    if (state.phase === 'downloading' || state.phase === 'checking') transition({ type: 'failed' })
  })

  scheduleAutomaticCheck(FIRST_CHECK_DELAY_MS)
}

export function getElectronUpdateState(): UpdateState {
  return state
}

export function onElectronUpdateStateChanged(listener: (state: UpdateState) => void): () => void {
  stateListeners.add(listener)
  return () => stateListeners.delete(listener)
}

export function setElectronAutomaticChecks(enabled: boolean): UpdateState {
  if (!state.available) return state
  settingsStore.update({ automaticUpdateChecks: enabled })
  setState({ automaticallyChecksForUpdates: enabled })
  scheduleAutomaticCheck(enabled ? FIRST_CHECK_DELAY_MS : CHECK_INTERVAL_MS)
  return state
}

export function checkElectronForUpdates(): Promise<boolean> {
  if (!state.available) return Promise.resolve(false)
  if (state.phase === 'downloading' || state.phase === 'downloaded') return Promise.resolve(true)
  if (checkInFlight) return checkInFlight

  checkInFlight = autoUpdater
    .checkForUpdates()
    .then(() => true)
    .finally(() => {
      checkInFlight = null
    })
  return checkInFlight
}

export async function showAvailableElectronUpdate(): Promise<boolean> {
  if (!state.available) return Promise.resolve(false)
  if (state.phase === 'downloaded') {
    if (!await prepareAppQuit()) return false
    if (installRequested) return true
    installRequested = true
    installFailed = false
    try {
      autoUpdater.quitAndInstall(false, true)
    } catch (error) {
      finishFailedInstall()
      throw error
    }
    return !installFailed
  }
  if (state.phase === 'downloading') return downloadInFlight ?? Promise.resolve(true)
  if (state.phase !== 'available' || !state.availableVersion) return Promise.resolve(false)
  if (downloadInFlight) return downloadInFlight

  downloadToken = new electronUpdater.CancellationToken()
  setState({
    phase: 'downloading',
    downloadProgress: { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 }
  })
  downloadInFlight = autoUpdater
    .downloadUpdate(downloadToken)
    .then(() => true)
    .catch((error) => {
      if (downloadToken?.cancelled) return true
      throw error
    })
    .finally(() => {
      downloadToken?.dispose()
      downloadToken = null
      downloadInFlight = null
    })
  return downloadInFlight
}

export function cancelElectronUpdateDownload(): boolean {
  if (!downloadToken || state.phase !== 'downloading') return false
  const version = state.availableVersion
  downloadToken.cancel()
  if (version) transition({ type: 'available', version })
  return true
}
