import type { UpdateState } from '../shared/types'
import {
  checkElectronForUpdates,
  cancelElectronUpdateDownload,
  getElectronUpdateState,
  onElectronUpdateStateChanged,
  setElectronAutomaticChecks,
  showAvailableElectronUpdate,
  startElectronUpdater
} from './electronUpdater'
import {
  checkSparkleForUpdates,
  getSparkleState,
  onSparkleStateChanged,
  setSparkleAutomaticChecks,
  showAvailableSparkleUpdate,
  startSparkle
} from './sparkle'

const usesSparkle = process.platform === 'darwin'

export function startUpdates(): void {
  if (usesSparkle) startSparkle()
  else startElectronUpdater()
}

export function getUpdateState(): UpdateState {
  return usesSparkle ? getSparkleState() : getElectronUpdateState()
}

export function onUpdateStateChanged(listener: (state: UpdateState) => void): () => void {
  return usesSparkle ? onSparkleStateChanged(listener) : onElectronUpdateStateChanged(listener)
}

export async function setAutomaticUpdateChecks(enabled: boolean): Promise<UpdateState> {
  return usesSparkle ? setSparkleAutomaticChecks(enabled) : setElectronAutomaticChecks(enabled)
}

export async function checkForUpdates(): Promise<boolean> {
  return usesSparkle ? checkSparkleForUpdates() : checkElectronForUpdates()
}

export async function showAvailableUpdate(): Promise<boolean> {
  return usesSparkle ? showAvailableSparkleUpdate() : showAvailableElectronUpdate()
}

export async function cancelUpdateDownload(): Promise<boolean> {
  return usesSparkle ? false : cancelElectronUpdateDownload()
}
