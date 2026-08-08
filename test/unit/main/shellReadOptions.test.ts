import { describe, expect, it, vi } from 'vitest'
import type { Db } from 'mongodb'
import { makeDbProxy } from '../../../src/main/mongo/shellCore'

describe('shell read options', () => {
  it('applies cancellation/default timeout and preserves an explicit timeout', () => {
    const find = vi.fn(() => ({ toArray: vi.fn() }))
    const collection = vi.fn(() => ({ find }))
    const controller = new AbortController()
    const db = makeDbProxy({ collection } as unknown as Db, controller.signal, 30_000)

    const items = (
      db as unknown as {
        items: {
          find(filter: object, projection?: object, options?: object): void
        }
      }
    ).items

    items.find({ active: true })
    expect(find).toHaveBeenLastCalledWith(
      { active: true },
      expect.objectContaining({ maxTimeMS: 30_000, signal: controller.signal })
    )

    items.find({ active: true }, undefined, { maxTimeMS: 5_000 })
    expect(find).toHaveBeenLastCalledWith(
      { active: true },
      expect.objectContaining({ maxTimeMS: 5_000, signal: controller.signal })
    )
  })
})
