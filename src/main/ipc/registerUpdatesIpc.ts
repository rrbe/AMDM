import { BrowserWindow, ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import {
  checkSparkleForUpdates,
  getSparkleState,
  onSparkleStateChanged,
  setSparkleAutomaticChecks,
  showAvailableSparkleUpdate
} from '../sparkle'

export function registerUpdatesIpc(): void {
  ipcMain.handle(IPC.updatesCheck, () => checkSparkleForUpdates())
  ipcMain.handle(IPC.updatesGetState, () => getSparkleState())
  ipcMain.handle(IPC.updatesSetAutomaticChecks, (_event, enabled: boolean) =>
    setSparkleAutomaticChecks(enabled)
  )
  ipcMain.handle(IPC.updatesShowAvailable, () => showAvailableSparkleUpdate())
  onSparkleStateChanged((state) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send(IPC.updatesStateChanged, state)
      }
    }
  })
}
