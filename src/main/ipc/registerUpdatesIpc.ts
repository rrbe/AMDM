import { BrowserWindow, ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import {
  cancelUpdateDownload,
  checkForUpdates,
  getUpdateState,
  onUpdateStateChanged,
  setAutomaticUpdateChecks,
  showAvailableUpdate
} from '../updater'

export function registerUpdatesIpc(): void {
  ipcMain.handle(IPC.updatesCheck, () => checkForUpdates())
  ipcMain.handle(IPC.updatesGetState, () => getUpdateState())
  ipcMain.handle(IPC.updatesSetAutomaticChecks, (_event, enabled: boolean) =>
    setAutomaticUpdateChecks(enabled)
  )
  ipcMain.handle(IPC.updatesShowAvailable, () => showAvailableUpdate())
  ipcMain.handle(IPC.updatesCancelDownload, () => cancelUpdateDownload())
  onUpdateStateChanged((state) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send(IPC.updatesStateChanged, state)
      }
    }
  })
}
