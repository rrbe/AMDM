/**
 * Connection-config export / import (backup & migrate) — the effectful shell
 * around {@link connectionBackupCore}. Secrets are NEVER included: passwords /
 * SSH passphrases live in the OS keychain via `safeStorage` (ADR-0006) and stay
 * there, so an imported connection arrives without secrets and the user
 * re-enters them before connecting.
 *
 * Import always mints fresh ids (via the store), so restoring a backup never
 * overwrites an existing connection — it adds.
 */
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dialog, type BrowserWindow } from 'electron'
import type { DataOpResult } from '../../shared/types'
import { connectionStore } from '../store/connectionStore'
import { buildBackup, parseBackupConnections } from './connectionBackupCore'

export async function exportConnections(win: BrowserWindow | null): Promise<DataOpResult> {
  const conns = connectionStore.listConnections()
  if (conns.length === 0) return { ok: false, error: '没有可导出的连接。' }

  const opts = {
    title: '导出连接配置',
    defaultPath: 'connections-backup.json',
    filters: [{ name: 'JSON', extensions: ['json'] }]
  }
  const picked = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
  if (picked.canceled || !picked.filePath) return { ok: false, cancelled: true }

  try {
    const backup = buildBackup(conns, Date.now())
    writeFileSync(picked.filePath, JSON.stringify(backup, null, 2), 'utf8')
    return { ok: true, filePath: picked.filePath, count: backup.connections.length }
  } catch (e) {
    return { ok: false, error: errMsg(e), filePath: picked.filePath }
  }
}

export async function importConnections(win: BrowserWindow | null): Promise<DataOpResult> {
  const opts = {
    title: '导入连接配置',
    properties: ['openFile' as const],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  }
  const picked = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  if (picked.canceled || picked.filePaths.length === 0) return { ok: false, cancelled: true }
  const filePath = picked.filePaths[0]

  try {
    const items = parseBackupConnections(JSON.parse(readFileSync(filePath, 'utf8')))
    if (!items) {
      return { ok: false, error: '无法识别的文件格式（缺少 connections 数组）。', filePath }
    }
    for (const item of items) connectionStore.saveConnection({ ...item, id: randomUUID() })
    if (items.length === 0) return { ok: false, error: '没有可导入的有效连接。', filePath }
    return {
      ok: true,
      filePath,
      count: items.length,
      warning: '密钥未包含在备份中——连接前请重新输入密码 / SSH 口令。'
    }
  } catch (e) {
    return { ok: false, error: errMsg(e), filePath }
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
