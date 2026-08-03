import { join } from 'node:path'
import { app, BrowserWindow, shell, nativeImage, screen } from 'electron'
import appIcon from '../../build/icon.png?asset'
import { connectionStore } from './store/connectionStore'
import { queryStore } from './store/queryStore'
import { settingsStore } from './store/settingsStore'
import { windowStateStore } from './store/windowStateStore'
import { resolveWindowBounds } from './store/windowStateCore'
import { sessionManager } from './mongo/sessionManager'
import { serializerPool } from './workers/serializerPool'
import { registerIpc } from './ipc/registerIpc'
import { startSparkle } from './sparkle'
import { isSettingsWindowUrl } from './windowOpenCore'

// Default geometry, also the floor on size. Saved bounds are reconciled against
// these + the connected displays in windowStateCore (off-screen safety).
const WINDOW_DEFAULTS = { width: 1440, height: 920, minWidth: 980, minHeight: 620 }

function createWindow(): void {
  const saved = windowStateStore.get()
  const bounds = resolveWindowBounds(
    saved.bounds,
    screen.getAllDisplays().map((d) => d.workArea),
    {
      minWidth: WINDOW_DEFAULTS.minWidth,
      minHeight: WINDOW_DEFAULTS.minHeight,
      defaultWidth: WINDOW_DEFAULTS.width,
      defaultHeight: WINDOW_DEFAULTS.height
    }
  )

  const win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: WINDOW_DEFAULTS.minWidth,
    minHeight: WINDOW_DEFAULTS.minHeight,
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    // Align the macOS traffic lights with the sidebar's compact top row.
    trafficLightPosition: process.platform === 'darwin' ? { x: 13, y: 8 } : undefined,
    backgroundColor: '#1e1e1e',
    // Window/taskbar icon for Windows + Linux (macOS uses the .app bundle icon).
    icon: appIcon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  // Full screen and maximize are mutually exclusive; full screen wins so the
  // restored geometry matches how the window was left.
  if (saved.isFullScreen) win.setFullScreen(true)
  else if (saved.isMaximized) win.maximize()

  win.on('ready-to-show', () => win.show())

  // Remember the window geometry across launches. getNormalBounds() returns the
  // restored (un-maximized, un-fullscreen) rect, so re-maximizing / re-entering
  // full screen next launch still restores to a sane size. Debounced because
  // resize/move fire in bursts while dragging.
  let persistTimer: ReturnType<typeof setTimeout> | null = null
  const persistBounds = (): void => {
    if (win.isDestroyed()) return
    windowStateStore.save({
      bounds: win.getNormalBounds(),
      isMaximized: win.isMaximized(),
      isFullScreen: win.isFullScreen()
    })
  }
  const schedulePersist = (): void => {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(persistBounds, 400)
  }
  win.on('resize', schedulePersist)
  win.on('move', schedulePersist)
  win.on('maximize', schedulePersist)
  win.on('unmaximize', schedulePersist)
  win.on('enter-full-screen', schedulePersist)
  win.on('leave-full-screen', schedulePersist)
  win.on('close', () => {
    if (persistTimer) clearTimeout(persistTimer)
    persistBounds() // flush synchronously before the window goes away
  })

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
    if (isSettingsWindowUrl(url, win.webContents.getURL())) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 900,
          height: 620,
          minWidth: 720,
          minHeight: 500,
          title: 'Settings',
          titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
          trafficLightPosition: process.platform === 'darwin' ? { x: 13, y: 13 } : undefined,
          backgroundColor: '#edece8',
          icon: appIcon,
          webPreferences: {
            preload: join(__dirname, '../preload/index.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false
          }
        }
      }
    }
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
  // Show our icon on the macOS dock during development (packaged builds use
  // the .app bundle icon, whose file lives inside the asar — skip those).
  if (process.platform === 'darwin' && !app.isPackaged) {
    app.dock?.setIcon(nativeImage.createFromPath(appIcon))
  }

  connectionStore.init()
  queryStore.init()
  settingsStore.init()
  windowStateStore.init()
  registerIpc()
  createWindow()
  startSparkle()

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
