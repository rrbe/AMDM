import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'

const electron = vi.hoisted(() => ({
  filePath: '',
  openPath: vi.fn(async (_path: string) => ''),
  showSaveDialog: vi.fn(async () => ({ canceled: false, filePath: electron.filePath }))
}))

vi.mock('electron', () => ({
  dialog: { showSaveDialog: electron.showSaveDialog },
  shell: { openPath: electron.openPath }
}))

vi.mock('../../../src/main/mongo/sessionManager', () => ({
  sessionManager: { getCollection: vi.fn() }
}))

import { exportData, openExportedFile } from '../../../src/main/io/exporter'

function owner(id: number): WebContents {
  return {
    id,
    isDestroyed: () => false,
    once: vi.fn(),
    removeListener: vi.fn(),
    send: vi.fn()
  } as unknown as WebContents
}

describe('open exported file', () => {
  let outputDir: string

  beforeEach(() => {
    outputDir = mkdtempSync(join(tmpdir(), 'amdm-export-open-'))
    electron.filePath = join(outputDir, 'result.csv')
    electron.openPath.mockClear()
    electron.showSaveDialog.mockClear()
  })

  afterEach(() => {
    rmSync(outputDir, { recursive: true, force: true })
  })

  it('opens only the latest completed export owned by the requesting Renderer', async () => {
    const exportingOwner = owner(1)
    const result = await exportData(
      {
        taskId: 'export-1',
        source: 'result',
        format: 'csv',
        documents: [{ name: 'Ada' }]
      },
      null,
      exportingOwner
    )

    expect(result).toMatchObject({ ok: true, filePath: electron.filePath, count: 1 })
    await expect(openExportedFile('export-1', exportingOwner)).resolves.toBeNull()
    expect(electron.openPath).toHaveBeenCalledWith(electron.filePath)

    await expect(openExportedFile('export-1', owner(2))).resolves.toBe(
      'Exported file is no longer available.'
    )
    await expect(openExportedFile('another-task', exportingOwner)).resolves.toBe(
      'Exported file is no longer available.'
    )
    expect(electron.openPath).toHaveBeenCalledTimes(1)
  })
})
