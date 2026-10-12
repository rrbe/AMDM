import type { QuickSearchIndex } from './engine'
import type { SearchDocument, SearchRequest, SearchResult, SearchWorkerResponse } from './types'
import { yieldSearchTask } from './types'

/** One dialog owns one lazy worker and its index; closing releases both. */
export class QuickSearchClient {
  private worker: Worker | null = null
  private fallback: QuickSearchIndex | null = null
  private updates = Promise.resolve()
  private documents = new Map<string, SearchDocument>()
  private seq = 0
  private disposed = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private request: SearchRequest | null = null
  mode: 'worker' | 'inline' = 'worker'

  constructor(private receive: (result: SearchResult | null, error?: string) => void) {
    try {
      this.worker = new Worker(new URL('./search.worker.ts', import.meta.url), { type: 'module' })
      this.worker.onmessage = ({ data }: MessageEvent<SearchWorkerResponse>) => {
        if (this.disposed || data.seq !== this.seq) return
        clearTimeout(this.timer)
        if (data.error) this.fail(new Error(data.error))
        else this.receive(data.result ?? null)
      }
      this.worker.onerror = (event) => this.fail(new Error(event.message))
      this.worker.onmessageerror = () => this.fail(new Error('Quick search worker message failed'))
    } catch (error) {
      this.fail(error)
    }
  }

  sync(documents: SearchDocument[]): Promise<void> {
    const next = new Map(documents.map((doc) => [doc.id, doc]))
    const upsert = documents.filter((doc) => {
      const old = this.documents.get(doc.id)
      return (
        !old ||
        old.group !== doc.group ||
        old.label !== doc.label ||
        old.icon !== doc.icon ||
        old.detail !== doc.detail ||
        old.searchDetail !== doc.searchDetail ||
        old.code !== doc.code ||
        old.connectionId !== doc.connectionId ||
        old.updatedAt !== doc.updatedAt ||
        old.count !== doc.count ||
        old.visitIds?.length !== doc.visitIds?.length ||
        doc.visitIds?.some((id, index) => old.visitIds?.[index] !== id)
      )
    })
    const remove = [...this.documents.keys()].filter((id) => !next.has(id))
    this.documents = next
    if (!upsert.length && !remove.length) return this.updates
    const worker = this.worker
    this.updates = this.updates.then(async () => {
      if (this.disposed) return
      if (!worker) {
        await this.fallback!.sync(upsert, remove, () => this.disposed)
        return
      }
      let started = performance.now()
      // Structured-cloning all query code in one message can itself block input.
      // Publish the complete update before allowing its search request through.
      for (let offset = 0; offset < Math.max(1, upsert.length); offset += 128) {
        if (this.disposed || this.worker !== worker) return
        worker.postMessage({
          type: 'sync',
          upsert: upsert.slice(offset, offset + 128),
          remove: offset === 0 ? remove : []
        })
        if (performance.now() - started >= 4) {
          await yieldSearchTask()
          started = performance.now()
        }
      }
    })
    return this.updates
  }

  search(request: SearchRequest): void {
    this.request = request
    const seq = ++this.seq
    clearTimeout(this.timer)
    void this.updates.then(() => {
      if (this.disposed || seq !== this.seq) return
      if (this.worker) {
        this.worker.postMessage({ type: 'search', seq, request })
        this.timer = setTimeout(() => this.fail(new Error('Quick search worker timed out')), 5000)
      } else this.searchInline(seq, request)
    })
  }

  cancel(): void {
    ++this.seq
    clearTimeout(this.timer)
    this.worker?.postMessage({ type: 'cancel' })
  }

  private fail(error: unknown): void {
    if (this.disposed || this.mode === 'inline') return
    console.warn('Quick search is using cooperative inline matching', error)
    this.mode = 'inline'
    clearTimeout(this.timer)
    this.worker?.terminate()
    this.worker = null
    this.updates = import('./engine').then(async ({ QuickSearchIndex }) => {
      if (this.disposed) return
      this.fallback = new QuickSearchIndex()
      await this.fallback.sync([...this.documents.values()], [], () => this.disposed)
    })
    if (this.request) this.searchInline(++this.seq, this.request)
  }

  private searchInline(seq: number, request: SearchRequest): void {
    void this.updates
      .then(async () => {
        if (this.disposed || seq !== this.seq) return
        const result = await this.fallback!.search(request, () => this.disposed || seq !== this.seq)
        if (result) this.receive(result)
      })
      .catch((error: unknown) => {
        if (!this.disposed && seq === this.seq)
          this.receive(null, error instanceof Error ? error.message : String(error))
      })
  }

  dispose(): void {
    this.disposed = true
    this.cancel()
    this.worker?.terminate()
    this.worker = null
    this.fallback = null
    this.documents.clear()
  }
}
