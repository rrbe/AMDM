import type { BrowserWindow } from 'electron'

type ForegroundWindow = Pick<BrowserWindow, 'isMinimized' | 'restore' | 'show' | 'moveTop' | 'focus'>

export function bringWindowToFront(win: ForegroundWindow): void {
  if (win.isMinimized()) win.restore()
  win.show()
  win.moveTop()
  win.focus()
}
