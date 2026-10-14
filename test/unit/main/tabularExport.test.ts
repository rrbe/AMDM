import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ExcelJS from 'exceljs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ExportProgressPhase, ResultExportRequest } from '../../../src/shared/types'
import { exportTabularToFile } from '../../../src/main/io/exporter'

const OID = '64b7f0f0f0f0f0f0f0f0f0f0'

let directory: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'amdm-tabular-test-'))
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

function request(format: ResultExportRequest['format']): ResultExportRequest {
  return {
    taskId: 'test-export',
    source: 'result',
    format,
    fieldSort: 'alpha',
    includeHeader: true,
    documents: [
      { z: 'x,y', id: { $oid: OID }, nested: { a: { $numberInt: '1' } } },
      { z: 'line\nbreak', id: { $oid: OID }, nested: [1, 2] }
    ]
  }
}

describe('tabular export streaming core', () => {
  it('writes CSV with BOM, CRLF, stable EJSON cells, and monotonic progress', async () => {
    const file = join(directory, 'result.csv')
    const progress: Array<{ phase: ExportProgressPhase; processed: number }> = []
    const count = await exportTabularToFile(
      { ...request('csv'), utf8Bom: true, lineEnding: 'crlf' },
      file,
      new AbortController().signal,
      (phase, processed) => progress.push({ phase, processed })
    )

    expect(count).toBe(2)
    expect(await readFile(file, 'utf8')).toBe(
      `\uFEFFid,nested,z\r\n${OID},"{""a"":1}","x,y"\r\n${OID},"[1,2]","line\nbreak"\r\n`
    )
    expect(progress[0]).toEqual({ phase: 'scanning', processed: 0 })
    expect(progress.at(-1)).toEqual({ phase: 'writing', processed: 2 })
    for (let index = 1; index < progress.length; index += 1) {
      if (progress[index].phase === progress[index - 1].phase) {
        expect(progress[index].processed).toBeGreaterThanOrEqual(progress[index - 1].processed)
      }
    }
  })

  it('writes headerless TSV with LF line endings', async () => {
    const file = join(directory, 'result.tsv')
    const count = await exportTabularToFile(
      {
        ...request('tsv'),
        includeHeader: false,
        utf8Bom: false,
        lineEnding: 'lf'
      },
      file,
      new AbortController().signal
    )

    expect(count).toBe(2)
    expect(await readFile(file, 'utf8')).toBe(`${OID}\t"{""a"":1}"\tx,y\n${OID}\t[1,2]\t"line\nbreak"\n`)
  })

  it('writes a supported custom delimiter', async () => {
    const file = join(directory, 'result.csv')
    await exportTabularToFile(
      {
        ...request('csv'),
        utf8Bom: false,
        lineEnding: 'lf',
        delimiter: ';'
      },
      file,
      new AbortController().signal
    )

    expect(await readFile(file, 'utf8')).toBe(
      `id;nested;z\n${OID};"{""a"":1}";x,y\n${OID};[1,2];"line\nbreak"\n`
    )
  })

  it('streams XLSX rows with a sanitized worksheet name and native dates', async () => {
    const file = join(directory, 'result.xlsx')
    await exportTabularToFile(
      {
        ...request('xlsx'),
        worksheetName: "  sales/[2026]*?'  ",
        documents: [
          {
            createdAt: { $date: '2026-08-14T00:00:00.000Z' },
            count: { $numberInt: '3' }
          }
        ]
      },
      file,
      new AbortController().signal
    )

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(file)
    const worksheet = workbook.worksheets[0]
    expect(worksheet.name).toBe('sales 2026')
    expect(worksheet.getRow(1).values).toEqual([, 'count', 'createdAt'])
    expect(worksheet.getCell('A2').value).toBe(3)
    expect(worksheet.getCell('B2').value).toEqual(new Date('2026-08-14T00:00:00.000Z'))
  })

  it('rejects cancellation and removes an incomplete output file', async () => {
    const file = join(directory, 'cancelled.csv')
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(exportTabularToFile(request('csv'), file, controller.signal)).rejects.toMatchObject({
      name: 'AbortError'
    })
    expect(existsSync(file)).toBe(false)
  })

  it('stops during scanning and removes the partial output', async () => {
    const file = join(directory, 'stopped.csv')
    const controller = new AbortController()
    const large = {
      ...request('csv'),
      documents: Array.from({ length: 500 }, (_, index) => ({
        index,
        value: `row-${index}`
      }))
    }

    await expect(
      exportTabularToFile(large, file, controller.signal, (phase, processed) => {
        if (phase === 'scanning' && processed === 100) {
          controller.abort(new DOMException('cancelled', 'AbortError'))
        }
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(existsSync(file)).toBe(false)
  })
})
