/**
 * Main-thread client for the TS-service worker. Lazily spawns the worker (the
 * heavy `typescript` chunk loads only on first use / warm), pushes the base
 * declarations once, refreshes per-(connection,db) collection declarations when
 * they change, and resolves `complete()` requests by sequence id.
 *
 * Robustness contract (mirrors serializerPool): if the worker can't spawn or
 * errors, `failed` latches and every call resolves to null — the caller then
 * falls back to the regex completion source, so completion never breaks.
 */
import { MONGO_BASE_DTS, buildCollectionDecls } from '@renderer/lib/tsAutocomplete/mongoBaseDts'
import type { TsWorkerResponse, TsCompletionEntry } from '@renderer/lib/tsAutocomplete/protocol'

export interface TsCompletionResult {
  entries: TsCompletionEntry[]
  replacementSpan?: { from: number }
}

const REQUEST_TIMEOUT = 2000

class TsAutocompleteClient {
  private worker: Worker | null = null
  private failed = false
  private seq = 0
  private declsKey = ''
  private pending = new Map<number, (result: TsCompletionResult | null) => void>()

  /** Spawn the worker if needed. Latches `failed` on any error. */
  private ensure(): void {
    if (this.worker || this.failed) return
    try {
      this.worker = new Worker(new URL('./tsService.worker.ts', import.meta.url), {
        type: 'module'
      })
      this.worker.onmessage = (e: MessageEvent<TsWorkerResponse>): void => {
        const msg = e.data
        if (msg.type === 'result') {
          const resolve = this.pending.get(msg.seq)
          if (resolve) {
            this.pending.delete(msg.seq)
            resolve({ entries: msg.entries, replacementSpan: msg.replacementSpan })
          }
        }
      }
      this.worker.onerror = (): void => this.die()
      this.worker.onmessageerror = (): void => this.die()
      this.worker.postMessage({ type: 'init', baseDts: MONGO_BASE_DTS })
    } catch {
      this.die()
    }
  }

  private die(): void {
    this.failed = true
    try {
      this.worker?.terminate()
    } catch {
      /* ignore */
    }
    this.worker = null
    for (const resolve of this.pending.values()) resolve(null)
    this.pending.clear()
  }

  /** Pre-spawn + warm the service (call when the editor mounts). */
  warm(): void {
    this.ensure()
  }

  isAvailable(): boolean {
    return !this.failed
  }

  /** Refresh the live collection declarations if they changed (cheap no-op otherwise). */
  updateCollections(connId: string, db: string, names: string[]): void {
    if (this.failed) return
    this.ensure()
    const key = `${connId}:${db}:${names.length}:${names.join(',')}`
    if (key === this.declsKey) return
    this.declsKey = key
    this.worker?.postMessage({ type: 'decls', text: buildCollectionDecls(names) })
  }

  /** Request completions at `pos` in `code`. Resolves null on failure/timeout. */
  complete(code: string, pos: number): Promise<TsCompletionResult | null> {
    this.ensure()
    if (!this.worker || this.failed) return Promise.resolve(null)
    const seq = ++this.seq
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(seq)) resolve(null)
      }, REQUEST_TIMEOUT)
      this.pending.set(seq, (result) => {
        clearTimeout(timer)
        resolve(result)
      })
      this.worker!.postMessage({ type: 'complete', seq, code, pos })
    })
  }

  /** Drop a pending request (the result is no longer wanted). */
  cancel(): void {
    // Stale results are ignored by seq bookkeeping; nothing to abort worker-side.
  }
}

export const tsAutocomplete = new TsAutocompleteClient()
export { buildCollectionDecls }
