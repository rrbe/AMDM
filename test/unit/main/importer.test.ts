import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  filePath: '',
  insertMany: vi.fn(async (documents: unknown[]) => ({ insertedCount: documents.length })),
  showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: [io.filePath] }))
}))

vi.mock('electron', () => ({
  dialog: { showOpenDialog: io.showOpenDialog }
}))

vi.mock('../../../src/main/mongo/sessionManager', () => ({
  sessionManager: {
    getClient: () => ({
      db: () => ({
        collection: () => ({ insertMany: io.insertMany })
      })
    })
  }
}))

import { importData } from '../../../src/main/io/importer'

describe('automatic data import', () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'amdm-import-'))
    io.insertMany.mockClear()
    io.showOpenDialog.mockClear()
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  it('detects and imports TSV files without a format selection', async () => {
    io.filePath = join(directory, 'people.tsv')
    writeFileSync(io.filePath, 'name\tcity\nAda\tShenzhen\n', 'utf8')

    const result = await importData(
      { connectionId: 'connection', database: 'database', collection: 'people' },
      null
    )

    expect(result).toMatchObject({ ok: true, filePath: io.filePath, count: 1 })
    expect(io.insertMany).toHaveBeenCalledWith([{ name: 'Ada', city: 'Shenzhen' }], { ordered: false })
    expect(io.showOpenDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: [expect.objectContaining({ extensions: expect.arrayContaining(['jsonl', 'ndjson', 'tsv', 'bson']) })]
      })
    )
  })
})
