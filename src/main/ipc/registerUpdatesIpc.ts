import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import { checkSparkleForUpdates } from '../sparkle'

export function registerUpdatesIpc(): void {
  ipcMain.handle(IPC.updatesCheck, () => checkSparkleForUpdates())
}
