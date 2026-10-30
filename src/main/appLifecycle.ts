import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { IPC } from '../shared/ipc'
import { resolveLanguage } from '../shared/language'
import { sessionManager } from './mongo/desktopSession'
import { settingsStore } from './store/settingsStore'
import { serializerPool } from './workers/serializerPool'
import { ShutdownController } from './shutdownCore'

const CLEANUP_TIMEOUT_MS = 10_000

const messages = {
  en: {
    message: 'Close AMDM?',
    detail:
      'All database connections will be disconnected and running queries will be cancelled. Open tabs and unsaved content will not be restored.',
    buttons: ['Cancel', 'Close AMDM'],
    error: 'Unable to close AMDM'
  },
  'zh-CN': {
    message: '关闭 AMDM？',
    detail: '将断开所有数据库连接并取消正在执行的查询。已打开的标签页和未保存的内容不会恢复。',
    buttons: ['取消', '关闭 AMDM'],
    error: '无法关闭 AMDM'
  },
  'zh-TW': {
    message: '關閉 AMDM？',
    detail: '將中斷所有資料庫連線並取消正在執行的查詢。已開啟的分頁和未儲存的內容不會還原。',
    buttons: ['取消', '關閉 AMDM'],
    error: '無法關閉 AMDM'
  }
}

const mainWindows = new Map<BrowserWindow, boolean>()
let quitRequested = false
const text = (): typeof messages.en =>
  messages[resolveLanguage(settingsStore.get().language, app.getPreferredSystemLanguages())]

const shutdown = new ShutdownController({
  needsConfirmation: () =>
    settingsStore.get().confirmBeforeQuit &&
    (sessionManager.hasActiveSessions() || [...mainWindows.values()].some(Boolean)),
  confirm: async () => {
    const owner = [...mainWindows.keys()].find((win) => !win.isDestroyed())
    const { message, detail, buttons } = text()
    const options = {
      type: 'warning' as const,
      title: 'AMDM',
      message,
      detail,
      buttons,
      defaultId: 0,
      cancelId: 0,
      noLink: true
    }
    const result = owner
      ? await dialog.showMessageBox(owner, options)
      : await dialog.showMessageBox(options)
    return result.response === 1
  },
  cleanup: async () => {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      win.setEnabled(false)
      win.setProgressBar(2)
    }
    // A stalled Driver cursor/client close must not keep the process and its resources alive.
    const deadline = setTimeout(() => {
      console.error('[app shutdown] Resource cleanup timed out; forcing process exit')
      app.exit(1)
    }, CLEANUP_TIMEOUT_MS)
    try {
      await sessionManager.shutdown()
      serializerPool.dispose()
    } finally {
      clearTimeout(deadline)
      for (const win of windows) {
        if (!win.isDestroyed()) {
          win.setEnabled(true)
          win.setProgressBar(-1)
        }
      }
    }
  }
})

export function prepareAppQuit(): Promise<boolean> {
  return shutdown.prepare()
}

function requestQuit(): void {
  if (quitRequested) return
  quitRequested = true
  void prepareAppQuit()
    .then((confirmed) => {
      if (confirmed) app.quit()
    })
    .catch((error: unknown) => {
      console.error('[app shutdown]', error)
      dialog.showErrorBox(text().error, error instanceof Error ? error.message : String(error))
    })
    .finally(() => {
      quitRequested = false
    })
}

export function trackMainWindow(win: BrowserWindow): void {
  mainWindows.set(win, false)
  win.on('close', (event) => {
    if (shutdown.ready || mainWindows.size > 1) return
    event.preventDefault()
    requestQuit()
  })
  win.on('closed', () => {
    mainWindows.delete(win)
  })
}

export function registerAppLifecycle(): void {
  ipcMain.on(IPC.appWorkspaceChanged, (event, hasContent: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && mainWindows.has(win) && typeof hasContent === 'boolean')
      mainWindows.set(win, hasContent)
  })
  app.on('before-quit', (event) => {
    if (shutdown.ready) return
    event.preventDefault()
    requestQuit()
  })
}
