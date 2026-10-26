import { describe, expect, it, vi } from 'vitest'
import { cachedResultJsonLines, createResultJsonLines } from '@renderer/lib/resultJsonLines'
import * as format from '@renderer/lib/format'
import { selectDisplayFields } from '@renderer/lib/resultFields'

const options = { sort: 'natural' as const, idFirst: false, timeZone: 'Asia/Shanghai' }

describe('lazy result JSON lines', () => {
  it('matches eager formatting, field order, BSON tokens and fold boundaries', async () => {
    const documents = [
      JSON.parse('{"z":null,"a.b":1,"__proto__":2,"_id":{"$oid":"507f1f77bcf86cd799439011"},"nested":{"date":{"$date":{"$numberLong":"0"}},"items":[{},[],true,"text"]}}'),
      { missing: undefined, nested: { other: [1, 2] } },
      { $numberLong: '42' }, null, [1, {}]
    ]
    for (const fields of [null, [], ['nested', 'a.b', '__proto__'], ['_id', 'z']]) {
      for (const sort of ['natural', 'alpha', 'alphaDesc'] as const) {
        for (const idFirst of [false, true]) {
          const settings = { ...options, sort, idFirst }
          const source = await createResultJsonLines(documents, fields, settings, new AbortController().signal)
          const expected = format.toJsonLines(selectDisplayFields(documents, fields), settings.timeZone, sort, idFirst)
          expect(source.length).toBe(expected.length)
          expect(Array.from({ length: source.length }, (_, index) => source.getLine(index))).toEqual(expected)
          for (const includeRoot of [false, true]) {
            const foldable = expected.flatMap((line, index) => line.fold && (includeRoot || line.depth > 0) ? [index] : [])
            expect(source.foldableIndexes(includeRoot)).toEqual(foldable)
            expect(source.hasFoldable(includeRoot)).toBe(foldable.length > 0)
            for (const collapsed of [new Set<number>(), new Set(foldable), new Set(foldable.slice(1))]) {
              const visible = source.visibleRows(collapsed)
              expect(Array.from({ length: visible.length }, (_, row) => visible.at(row))).toEqual(format.visibleJsonLineIndexes(expected, collapsed))
            }
          }
        }
      }
    }
  })

  it('also supports standalone preview values and empty containers', async () => {
    for (const value of [null, undefined, 'hello', 42, {}, [], [{}], [[], {}], { a: [1, { b: 2 }] }]) {
      const source = await createResultJsonLines(value, null, options, new AbortController().signal)
      expect(Array.from({ length: source.length }, (_, index) => source.getLine(index))).toEqual(format.toJsonLines(value, options.timeZone))
    }
  })

  it('reuses indexed subtrees when changing fields after the full result was shown', async () => {
    const docs = [{ z: 1, nested: { a: [1, 2], b: {} }, end: 3 }, { other: 4, nested: [] }]
    const full = await createResultJsonLines(docs, null, options, new AbortController().signal)
    const original = Array.from({ length: full.length }, (_, index) => full.getLine(index))
    for (const fields of [['nested'], ['z', 'end'], [], ['nested', 'end']]) {
      const source = await createResultJsonLines(docs, fields, options, new AbortController().signal)
      expect(Array.from({ length: source.length }, (_, index) => source.getLine(index)))
        .toEqual(format.toJsonLines(selectDisplayFields(docs, fields), options.timeZone))
    }
    expect(Array.from({ length: full.length }, (_, index) => full.getLine(index))).toEqual(original)
  })

  it('formats only requested rows and bounds the formatted row cache', async () => {
    const spy = vi.spyOn(format, 'toJsonLines')
    try {
      const docs = [{ items: Array.from({ length: 1000 }, (_, index) => index) }]
      const source = await createResultJsonLines(docs, null, options, new AbortController().signal)
      expect(spy).not.toHaveBeenCalled()
      source.getLine(3)
      source.getLine(3)
      expect(spy).toHaveBeenCalledTimes(1)
      for (let index = 4; index < 270; index++) source.getLine(index)
      const count = spy.mock.calls.length
      source.getLine(3)
      expect(spy).toHaveBeenCalledTimes(count + 1)
      expect(cachedResultJsonLines(docs, null, options)).toBe(source)
    } finally {
      spy.mockRestore()
    }
  })

  it('does not read hidden subtrees and cancels superseded preparation', async () => {
    const hidden = vi.fn(() => { throw new Error('Hidden field was read') })
    const doc = Object.defineProperty({ shown: 1 }, 'hidden', { enumerable: true, get: hidden })
    const source = await createResultJsonLines([doc], ['shown'], options, new AbortController().signal)
    expect(source.getLine(2).text).toBe('"shown": 1')
    expect(hidden).not.toHaveBeenCalled()
    const controller = new AbortController()
    controller.abort()
    const docs = [{ items: Array.from({ length: 10000 }, (_, index) => index) }]
    await expect(createResultJsonLines(docs, null, options, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(cachedResultJsonLines(docs, null, options)).toBeUndefined()
  })

  it('yields during indexing so a newer result can cancel it', async () => {
    const docs = [{ items: Array.from({ length: 1000 }, (_, index) => index) }]
    const controller = new AbortController()
    let clock = 0
    const now = vi.spyOn(performance, 'now').mockImplementation(() => clock += 10)
    try {
      const pending = createResultJsonLines(docs, null, options, controller.signal)
      queueMicrotask(() => controller.abort())
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
      expect(cachedResultJsonLines(docs, null, options)).toBeUndefined()
    } finally {
      now.mockRestore()
    }
  })
})
