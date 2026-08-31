import type { ProgressInfo } from 'electron-updater'
import type { UpdateState } from '../shared/types'

export type ElectronUpdaterEvent =
  | { type: 'checking' }
  | { type: 'available'; version: string }
  | { type: 'not-available' }
  | { type: 'progress'; progress: ProgressInfo }
  | { type: 'downloaded'; version: string }
  | { type: 'failed' }

export function canUseElectronUpdater(
  isPackaged: boolean,
  platform: NodeJS.Platform,
  appImagePath: string | undefined
): boolean {
  if (!isPackaged) return false
  if (platform === 'win32') return true
  return platform === 'linux' && Boolean(appImagePath)
}

export function nextElectronUpdateState(state: UpdateState, event: ElectronUpdaterEvent): UpdateState {
  switch (event.type) {
    case 'checking':
      return { ...state, phase: 'checking', downloadProgress: null }
    case 'available':
      return {
        ...state,
        phase: 'available',
        availableVersion: event.version,
        downloadProgress: null
      }
    case 'not-available':
      return { ...state, phase: 'idle', availableVersion: null, downloadProgress: null }
    case 'progress':
      return {
        ...state,
        phase: 'downloading',
        downloadProgress: {
          percent: Math.max(0, Math.min(100, event.progress.percent)),
          transferred: event.progress.transferred,
          total: event.progress.total,
          bytesPerSecond: event.progress.bytesPerSecond
        }
      }
    case 'downloaded':
      return {
        ...state,
        phase: 'downloaded',
        availableVersion: event.version,
        downloadProgress: null
      }
    case 'failed':
      return {
        ...state,
        phase: state.availableVersion ? 'available' : 'idle',
        downloadProgress: null
      }
  }
}
