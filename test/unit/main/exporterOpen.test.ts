import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'

const electron = vi.hoisted(() => ({
  directoryPath: '',
  messageBoxResponse: 0,
  openPath: vi.fn(async (_path: string) => ''),
  showItemInFolder: vi.fn((_path: string) => undefined),
  showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: [electron.directoryPath] })),
  showMessageBox: vi.fn(async () => ({ response: electron.messageBoxResponse, checkboxChecked: false }))
}))

vi.mock('electron', () => ({
  app: { getLocale: () => 'zh-CN' },
  dialog: { showOpenDialog: electron.showOpenDialog, showMessageBox: electron.showMessageBox },
  shell: { openPath: electron.openPath, showItemInFolder: electron.showItemInFolder }
}))

vi.mock('../../../src/main/mongo/sessionManager', () => ({
  sessionManager: { getCollection: vi.fn() }
}))

import {
  chooseExportDirectory,
  exportData,
  openExportedFile,
  revealExportedFile
} from '../../../src/main/io/exporter'
import { decodeBsonFile } from '../../../src/main/io/bsonFileCore'

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
    electron.directoryPath = outputDir
    electron.messageBoxResponse = 0
    electron.openPath.mockClear()
    electron.showItemInFolder.mockClear()
    electron.showOpenDialog.mockClear()
    electron.showMessageBox.mockClear()
  })

  afterEach(() => {
    rmSync(outputDir, { recursive: true, force: true })
  })

  it('opens only the latest completed export owned by the requesting Renderer', async () => {
    const exportingOwner = owner(1)
    const directory = await chooseExportDirectory(null, exportingOwner, outputDir)
    expect(directory).not.toBeNull()
    expect(electron.showOpenDialog).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: outputDir, properties: ['openDirectory', 'createDirectory'] })
    )
    const result = await exportData(
      {
        taskId: 'export-1',
        source: 'result',
        format: 'csv',
        documents: [{ name: 'Ada' }],
        destination: {
          directorySelectionId: directory!.selectionId,
          fileName: 'result'
        }
      },
      null,
      exportingOwner
    )

    const filePath = join(outputDir, 'result.csv')
    expect(result).toMatchObject({ ok: true, filePath, count: 1 })
    await expect(openExportedFile('export-1', exportingOwner)).resolves.toBeNull()
    expect(electron.openPath).toHaveBeenCalledWith(filePath)

    await expect(openExportedFile('export-1', owner(2))).resolves.toBe(
      'Exported file is no longer available.'
    )
    await expect(openExportedFile('another-task', exportingOwner)).resolves.toBe(
      'Exported file is no longer available.'
    )
    expect(electron.openPath).toHaveBeenCalledTimes(1)
  })

  it('exports result documents as a canonical JSON array', async () => {
    const exportingOwner = owner(1)
    const directory = await chooseExportDirectory(null, exportingOwner, outputDir)
    const result = await exportData(
      {
        taskId: 'json-export',
        source: 'result',
        format: 'json',
        jsonEncoding: 'canonical',
        documents: [{ _id: { $oid: '64b7f0f0f0f0f0f0f0f0f0f0' }, count: { $numberLong: '42' } }],
        destination: {
          directorySelectionId: directory!.selectionId,
          fileName: 'result'
        }
      },
      null,
      exportingOwner
    )

    const filePath = join(outputDir, 'result.json')
    expect(result).toMatchObject({ ok: true, filePath, count: 1 })
    expect(readFileSync(filePath, 'utf8')).toBe(
      '[\n{"_id":{"$oid":"64b7f0f0f0f0f0f0f0f0f0f0"},"count":{"$numberLong":"42"}}\n]\n'
    )
  })

  it('exports result documents as plain JSONL', async () => {
    const exportingOwner = owner(1)
    const directory = await chooseExportDirectory(null, exportingOwner, outputDir)
    const result = await exportData(
      {
        taskId: 'jsonl-export',
        source: 'result',
        format: 'jsonl',
        jsonEncoding: 'plain',
        documents: [
          { _id: { $oid: '64b7f0f0f0f0f0f0f0f0f0f0' }, count: { $numberLong: '9007199254740993' } },
          { name: 'Ada' }
        ],
        destination: {
          directorySelectionId: directory!.selectionId,
          fileName: 'result'
        }
      },
      null,
      exportingOwner
    )

    const filePath = join(outputDir, 'result.jsonl')
    expect(result).toMatchObject({ ok: true, filePath, count: 2 })
    expect(readFileSync(filePath, 'utf8')).toBe(
      '{"_id":"64b7f0f0f0f0f0f0f0f0f0f0","count":"9007199254740993"}\n{"name":"Ada"}\n'
    )
  })

  it('exports result documents as BSON', async () => {
    const exportingOwner = owner(1)
    const directory = await chooseExportDirectory(null, exportingOwner, outputDir)
    const result = await exportData(
      {
        taskId: 'bson-export',
        source: 'result',
        format: 'bson',
        documents: [{ _id: { $oid: '64b7f0f0f0f0f0f0f0f0f0f0' }, count: { $numberLong: '42' } }],
        destination: {
          directorySelectionId: directory!.selectionId,
          fileName: 'result'
        }
      },
      null,
      exportingOwner
    )

    const filePath = join(outputDir, 'result.bson')
    expect(result).toMatchObject({ ok: true, filePath, count: 1 })
    const [document] = decodeBsonFile(readFileSync(filePath))
    expect(document._id.toHexString()).toBe('64b7f0f0f0f0f0f0f0f0f0f0')
    expect(document.count.toString()).toBe('42')
  })

  it('rejects non-document values in BSON result exports', async () => {
    const exportingOwner = owner(1)
    const directory = await chooseExportDirectory(null, exportingOwner, outputDir)
    const result = await exportData(
      {
        taskId: 'invalid-bson-export',
        source: 'result',
        format: 'bson',
        documents: ['not a document'],
        destination: {
          directorySelectionId: directory!.selectionId,
          fileName: 'result'
        }
      },
      null,
      exportingOwner
    )

    expect(result).toMatchObject({ ok: false, error: 'BSON export requires top-level document values.' })
  })

  it('reveals only the latest completed export owned by the requesting Renderer', async () => {
    const exportingOwner = owner(1)
    const directory = await chooseExportDirectory(null, exportingOwner, outputDir)
    await exportData(
      {
        taskId: 'export-1',
        source: 'result',
        format: 'csv',
        documents: [{ name: 'Ada' }],
        destination: {
          directorySelectionId: directory!.selectionId,
          fileName: 'result'
        }
      },
      null,
      exportingOwner
    )

    expect(revealExportedFile('export-1', exportingOwner)).toBeNull()
    expect(electron.showItemInFolder).toHaveBeenCalledWith(join(outputDir, 'result.csv'))
    expect(revealExportedFile('export-1', owner(2))).toBe('Exported file is no longer available.')
    expect(revealExportedFile('another-task', exportingOwner)).toBe(
      'Exported file is no longer available.'
    )
    expect(electron.showItemInFolder).toHaveBeenCalledTimes(1)
  })

  it('requires a directory capability owned by the requesting Renderer', async () => {
    const selectedByOtherOwner = await chooseExportDirectory(null, owner(1), outputDir)
    const result = await exportData(
      {
        taskId: 'export-1',
        source: 'result',
        format: 'csv',
        documents: [{ name: 'Ada' }],
        destination: {
          directorySelectionId: selectedByOtherOwner!.selectionId,
          fileName: 'result'
        }
      },
      null,
      owner(2)
    )

    expect(result).toEqual({
      ok: false,
      error: 'Export directory selection is no longer available. Choose it again.'
    })
  })

  it('defaults to cancelling when the selected file already exists', async () => {
    const exportingOwner = owner(1)
    const directory = await chooseExportDirectory(null, exportingOwner, outputDir)
    const filePath = join(outputDir, 'result.csv')
    writeFileSync(filePath, 'original')
    electron.messageBoxResponse = 1

    const result = await exportData(
      {
        taskId: 'export-1',
        source: 'result',
        format: 'csv',
        documents: [{ name: 'Ada' }],
        destination: {
          directorySelectionId: directory!.selectionId,
          fileName: 'result'
        }
      },
      null,
      exportingOwner
    )

    expect(result).toEqual({ ok: false, cancelled: true, filePath })
    expect(readFileSync(filePath, 'utf8')).toBe('original')
    expect(electron.showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'warning', defaultId: 1, cancelId: 1 })
    )
  })

  it('overwrites an existing file only after explicit confirmation', async () => {
    const exportingOwner = owner(1)
    const directory = await chooseExportDirectory(null, exportingOwner, outputDir)
    const filePath = join(outputDir, 'result.csv')
    writeFileSync(filePath, 'original')

    const result = await exportData(
      {
        taskId: 'export-1',
        source: 'result',
        format: 'csv',
        documents: [{ name: 'Ada' }],
        destination: {
          directorySelectionId: directory!.selectionId,
          fileName: 'result'
        }
      },
      null,
      exportingOwner
    )

    expect(result).toMatchObject({ ok: true, filePath, count: 1 })
    expect(readFileSync(filePath, 'utf8')).not.toBe('original')
    expect(electron.showMessageBox).toHaveBeenCalledTimes(1)
  })
})
