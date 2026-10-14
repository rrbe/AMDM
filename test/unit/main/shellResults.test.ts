import { afterEach, describe, expect, it, vi } from 'vitest'
import { access } from 'node:fs/promises'
import { ShellResultSession } from '../../../src/main/mongo/shellResults'

vi.mock('../../../src/main/workers/serializerPool', () => ({
  serializerPool: { serialize: async (documents: unknown[]) => documents }
}))

const sessions: ShellResultSession[] = []
function session(timeout = 1000) {
  const value = new ShellResultSession('c', 1, new AbortController(), timeout)
  sessions.push(value)
  return value
}
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((value) => value.close()))
})

describe('result cursor and cache lifecycle', () => {
  it('changes display boundaries across cached chunks without dropping or duplicating documents', async () => {
    const value = session()
    await value.capture(Array.from({length: 123}, (_,n) => ({n})))
    const page = await value.page(35, 70)
    expect(page.data).toEqual(Array.from({length: 70}, (_,n) => ({n:n+35})))
    expect(page).toMatchObject({count:70,totalCount:123,truncated:true})
    expect(await value.page(105,50)).toMatchObject({count:18,totalCount:123,truncated:false})
  })

  it('cancels a blocked cursor read and removes its cached pages when closed during the request', async () => {
    const value = session()
    let remaining = 1
    const cursor = {
      hasNext: async () => true,
      next: vi.fn().mockImplementation(() => remaining-- ? Promise.resolve({n:0}) : new Promise(() => {})),
      close: vi.fn().mockResolvedValue(undefined)
    }
    await value.capture(cursor)
    await value.page(0,1)
    const directory = (value as unknown as {directory:string}).directory
    const pending = value.page(1,1)
    await vi.waitFor(() => expect(cursor.next).toHaveBeenCalledTimes(2))
    const rejected = expect(pending).rejects.toThrow('closed')
    await value.close()
    await rejected
    expect(cursor.close).toHaveBeenCalledOnce()
    await expect(access(directory)).rejects.toMatchObject({code:'ENOENT'})
  })

  it('times out a blocked page read, releases its cursor, and still allows cached pages', async () => {
    const value = session(30)
    let first = true
    const cursor = {
      hasNext: async () => true,
      next: () => first ? (first=false, Promise.resolve({n:0})) : new Promise(() => {}),
      close: vi.fn().mockResolvedValue(undefined)
    }
    await value.capture(cursor)
    await value.page(0,1)
    await expect(value.page(1,1)).rejects.toMatchObject({name:'TimeoutError'})
    expect(cursor.close).toHaveBeenCalledOnce()
    expect((await value.page(0,1)).data).toEqual([{n:0}])
  })
})
