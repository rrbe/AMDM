import { join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import { connectionStore } from './store/connectionStore'
import { queryStore } from './store/queryStore'
import { settingsStore } from './store/settingsStore'
import { sessionManager } from './mongo/sessionManager'
import { serializerPool } from './workers/serializerPool'
import { registerIpc } from './ipc/registerIpc'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 620,
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.on('ready-to-show', () => win.show())

  // Dev diagnostics: surface renderer console + crashes in the terminal.
  // (Open DevTools yourself with Cmd/Ctrl+Alt+I when you need them.)
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
      console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`)
    })
    win.webContents.on('render-process-gone', (_e, details) => {
      console.error('[renderer gone]', details)
    })
    win.webContents.on('preload-error', (_e, path, error) => {
      console.error('[preload error]', path, error)
    })
    win.webContents.on('did-fail-load', (_e, code, desc) => {
      console.error('[did-fail-load]', code, desc)
    })
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // electron-vite injects the dev server URL; fall back to the built file.
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    win.loadURL(devUrl)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  connectionStore.init()
  queryStore.init()
  settingsStore.init()
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Clean up all clients + SSH tunnels + the serializer worker on quit
// (ADR-0004: no zombie processes / threads).
app.on('will-quit', () => {
  void sessionManager.closeAll()
  serializerPool.dispose()
})
