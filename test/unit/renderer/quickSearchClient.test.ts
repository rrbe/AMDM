import { afterEach, describe, expect, it, vi } from 'vitest'
import { QuickSearchClient } from '../../../src/renderer/src/lib/quickSearch/client'
import type {
  SearchDocument,
  SearchRequest,
  SearchWorkerResponse
} from '../../../src/renderer/src/lib/quickSearch/types'

class FakeWorker {
  static last: FakeWorker
  onmessage?: (event: MessageEvent<SearchWorkerResponse>) => void
  onerror?: (event: { message: string }) => void
  onmessageerror?: () => void
  postMessage = vi.fn()
  terminate = vi.fn()
  constructor() {
    FakeWorker.last = this
  }
}
const doc: SearchDocument = {
  id: 'q',
  group: 'queries',
  label: 'orders',
  detail: 'shop',
  code: 'db.orders.find()'
}
const request: SearchRequest = { query: 'orders', scope: 'queries', visits: [], connectionId: null }

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('search worker ownership', () => {
  it('publishes the complete snapshot before searching and abandons queued updates on close', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const client = new QuickSearchClient(vi.fn())
    const documents = Array.from({ length: 300 }, (_, n) => ({ ...doc, id: String(n) }))
    const sync = client.sync(documents)
    client.search(request)
    await sync
    await vi.waitFor(() => expect(FakeWorker.last.postMessage.mock.calls.at(-1)?.[0].type).toBe('search'))
    const published = FakeWorker.last.postMessage.mock.calls.filter(([message]) => message.type === 'sync').flatMap(([message]) => message.upsert)
    expect(published.map((entry) => entry.id)).toEqual(documents.map((entry) => entry.id))
    client.dispose()

    const closing = new QuickSearchClient(vi.fn())
    const pending = closing.sync(documents)
    closing.dispose()
    await pending
    expect(FakeWorker.last.postMessage.mock.calls.some(([message]) => message.type === 'sync')).toBe(false)
  })
  it('sends only changed documents and removals', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const client = new QuickSearchClient(vi.fn())
    await client.sync([doc])
    await client.sync([{ ...doc }])
    expect(FakeWorker.last.postMessage).toHaveBeenCalledTimes(1)
    await client.sync([])
    expect(FakeWorker.last.postMessage).toHaveBeenLastCalledWith({ type: 'sync', upsert: [], remove: ['q'] })
    client.dispose()
  })

  it('ignores stale responses and cancels/releases its worker on close', () => {
    vi.stubGlobal('Worker', FakeWorker)
    const receive = vi.fn()
    const client = new QuickSearchClient(receive)
    client.search(request)
    client.search({ ...request, query: 'products' })
    FakeWorker.last.onmessage!({ data: { seq: 1 } } as MessageEvent<SearchWorkerResponse>)
    expect(receive).not.toHaveBeenCalled()
    FakeWorker.last.onmessage!({ data: { seq: 2 } } as MessageEvent<SearchWorkerResponse>)
    expect(receive).toHaveBeenCalledOnce()
    client.dispose()
    expect(FakeWorker.last.terminate).toHaveBeenCalledOnce()
    FakeWorker.last.onmessage!({ data: { seq: 2 } } as MessageEvent<SearchWorkerResponse>)
    expect(receive).toHaveBeenCalledOnce()
  })

  it('reconstructs the live index and completes the latest request after worker failure', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const receive = vi.fn()
    const client = new QuickSearchClient(receive)
    client.sync([doc])
    client.search(request)
    FakeWorker.last.onerror!({ message: 'fixture failure' })
    await vi.waitFor(() => expect(receive).toHaveBeenCalledOnce())
    expect(receive.mock.calls[0][0].hits[0].id).toBe('q')
    expect(client.mode).toBe('inline')
    client.dispose()
  })
})
