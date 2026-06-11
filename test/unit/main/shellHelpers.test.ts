/**
 * Pure helpers from the shell core: cross-realm error description, best-effort
 * collection detection for doc edit/delete, and the async-aware array patch
 * that lets rewritten (promise-returning) callbacks work with forEach/map/….
 */
import { describe, it, expect } from 'vitest'
import {
  describeError,
  detectCollection,
  markSyntheticPromise,
  patchAsyncAwareArray
} from '../../../src/main/mongo/shellCore'

describe('describeError', () => {
  it('reads a real Error', () => {
    expect(describeError(new TypeError('boom'))).toEqual({ error: 'boom', errorName: 'TypeError' })
  })
  it('duck-types a cross-realm error (instanceof Error is false in the vm)', () => {
    expect(describeError({ name: 'ReferenceError', message: 'x is not defined' })).toEqual({
      error: 'x is not defined',
      errorName: 'ReferenceError'
    })
  })
  it('falls back to Error when only a message is present', () => {
    expect(describeError({ message: 'm' })).toEqual({ error: 'm', errorName: 'Error' })
  })
  it('keeps a custom name even without a message', () => {
    expect(describeError({ name: 'CustomError' }).errorName).toBe('CustomError')
  })
  it('stringifies non-object throwables', () => {
    expect(describeError('plain string')).toEqual({ error: 'plain string', errorName: 'Error' })
    expect(describeError(42)).toEqual({ error: '42', errorName: 'Error' })
    expect(describeError(null)).toEqual({ error: 'null', errorName: 'Error' })
  })
})

describe('detectCollection', () => {
  it('detects dotted access', () => {
    expect(detectCollection('db.users.find({})')).toBe('users')
    expect(detectCollection('db.lives.aggregate([])')).toBe('lives')
  })
  it('detects getCollection and bracket access (allowing dots/dashes in the name)', () => {
    expect(detectCollection("db.getCollection('my-coll').find()")).toBe('my-coll')
    expect(detectCollection("db['weird.name'].countDocuments()")).toBe('weird.name')
  })
  it('ignores db-level methods (not collection names)', () => {
    expect(detectCollection('db.runCommand({ ping: 1 })')).toBeUndefined()
    expect(detectCollection('db.getCollectionNames()')).toBeUndefined()
    expect(detectCollection('db.aggregate([])')).toBeUndefined()
    expect(detectCollection('db.stats()')).toBeUndefined()
  })
  it('returns undefined when no collection is referenced', () => {
    expect(detectCollection('const x = 1')).toBeUndefined()
  })
})

const SYNTHETIC = Symbol.for('@@mongosh.syntheticPromise')
const isTagged = (v: unknown): boolean =>
  Boolean((v as Record<symbol, unknown>)[SYNTHETIC])

describe('patchAsyncAwareArray', () => {
  it('keeps exact native behavior (and sync return) for sync callbacks', () => {
    const a = patchAsyncAwareArray([1, 2, 3])
    const seen: number[] = []
    expect(a.forEach((v) => seen.push(v as number))).toBeUndefined()
    expect(seen).toEqual([1, 2, 3])
    expect(a.map((v) => (v as number) * 2)).toEqual([2, 4, 6])
    expect(a.filter((v) => (v as number) > 1)).toEqual([2, 3])
    expect(a.find((v) => (v as number) === 2)).toBe(2)
    expect(a.findIndex((v) => (v as number) === 3)).toBe(2)
    expect(a.some((v) => (v as number) > 2)).toBe(true)
    expect(a.every((v) => (v as number) > 0)).toBe(true)
    expect(a.reduce((acc, v) => (acc as number) + (v as number), 0)).toBe(6)
    expect(a.flatMap((v) => [v, v])).toEqual([1, 1, 2, 2, 3, 3])
  })

  it('awaits thenable callback results sequentially and returns a tagged promise', async () => {
    const a = patchAsyncAwareArray([1, 2, 3])
    const order: number[] = []
    const mapped = a.map(async (v) => {
      order.push(v as number)
      return (v as number) * 10
    }) as unknown as Promise<number[]>
    expect(isTagged(mapped)).toBe(true)
    expect(await mapped).toEqual([10, 20, 30])
    expect(order).toEqual([1, 2, 3])
  })

  it('forEach with an async callback resolves to undefined after all callbacks ran', async () => {
    const a = patchAsyncAwareArray(['x', 'y'])
    const seen: string[] = []
    const r = a.forEach(async (v) => {
      seen.push(v as string)
    }) as unknown as Promise<undefined>
    expect(isTagged(r)).toBe(true)
    expect(await r).toBeUndefined()
    expect(seen).toEqual(['x', 'y'])
  })

  it('filter/find/some/every/reduce handle async predicates with early exit', async () => {
    const a = patchAsyncAwareArray([1, 2, 3, 4])
    expect(await (a.filter(async (v) => (v as number) % 2 === 0) as unknown)).toEqual([2, 4])
    const probed: number[] = []
    const found = a.find(async (v) => {
      probed.push(v as number)
      return (v as number) >= 2
    }) as unknown as Promise<number>
    expect(await found).toBe(2)
    expect(probed).toEqual([1, 2]) // early exit: 3 and 4 never probed
    expect(await (a.some(async (v) => (v as number) > 3) as unknown)).toBe(true)
    expect(await (a.every(async (v) => (v as number) > 0) as unknown)).toBe(true)
    expect(await (a.reduce(async (acc, v) => (acc as number) + (v as number), 0) as unknown)).toBe(10)
  })

  it('flatMap/findIndex handle async callbacks', async () => {
    const a = patchAsyncAwareArray([1, 2, 3])
    expect(await (a.flatMap(async (v) => [v, (v as number) * 10]) as unknown)).toEqual([
      1, 10, 2, 20, 3, 30
    ])
    expect(await (a.findIndex(async (v) => (v as number) === 2) as unknown)).toBe(1)
  })

  it('reduceRight folds right-to-left, sync and async', async () => {
    const a = patchAsyncAwareArray(['a', 'b', 'c'])
    expect(a.reduceRight((acc, v) => (acc as string) + v)).toBe('cba')
    expect(await (a.reduceRight(async (acc, v) => (acc as string) + v, '') as unknown)).toBe('cba')
  })

  it('reduce/reduceRight without an initial value seed from the array end', async () => {
    const a = patchAsyncAwareArray([1, 2, 3])
    // No initial value + async callback: acc seeds sync from the array, the
    // first callback result is a thenable, so the rest of the fold awaits.
    expect(await (a.reduce(async (acc, v) => (acc as number) + (v as number)) as unknown)).toBe(6)
    expect(
      await (a.reduceRight(async (acc, v) => (acc as number) - (v as number)) as unknown)
    ).toBe(0) // 3 - 2 - 1
    expect(() => patchAsyncAwareArray([]).reduce((acc) => acc)).toThrow(TypeError)
    expect(() => patchAsyncAwareArray([]).reduceRight((acc) => acc)).toThrow(TypeError)
  })

  it('async map results are patched too, so chains stay async-aware', async () => {
    const a = patchAsyncAwareArray([1, 2])
    const mapped = (await (a.map(async (v) => v) as unknown)) as number[]
    const chained = mapped.map(async (v) => v * 3) as unknown as Promise<number[]>
    expect(isTagged(chained)).toBe(true)
    expect(await chained).toEqual([3, 6])
  })

  it('is idempotent and invisible to JSON/iteration', () => {
    const a = patchAsyncAwareArray([1, 2])
    expect(patchAsyncAwareArray(a)).toBe(a)
    expect(JSON.stringify(a)).toBe('[1,2]')
    expect(Object.keys(a)).toEqual(['0', '1'])
  })
})

describe('markSyntheticPromise', () => {
  it('tags a promise and patches a resolved array with async-aware helpers', async () => {
    const p = markSyntheticPromise(Promise.resolve(['a', 'b']))
    expect(isTagged(p)).toBe(true)
    const arr = await p
    const r = arr.forEach(async () => {}) as unknown
    expect(isTagged(r)).toBe(true) // own async-aware forEach, not the native one
  })

  it('passes non-thenables through untouched and re-tags idempotently', () => {
    expect(markSyntheticPromise(42)).toBe(42)
    const p = markSyntheticPromise(Promise.resolve(1))
    expect(markSyntheticPromise(p)).toBe(p)
  })
})
