/**
 * Main-thread client for the serializer worker (ADR-0004 rules 3 & 4).
 *
 * A single long-lived worker is plenty for a single-user GUI — jobs queue and
 * resolve by id. The main thread only does the cheap binary `BSON.serialize`
 * (wrapping each value as `{ v }`); the worker does the expensive EJSON encode
 * and field extraction.
 *
 * Robustness: if the worker can't spawn or dies mid-flight, we transparently
 * fall back to running the SAME core helpers inline. The app keeps working —
 * it just loses the off-thread benefit — so a bundling/runtime hiccup with the
 * worker can never white-screen or hang the renderer.
 *
 * NOTE: we intentionally do NOT use a transferList for the BSON buffers.
 * `BSON.serialize` may return a Buffer backed by Node's shared allocation pool;
 * transferring its ArrayBuffer would detach unrelated Buffers. Structured-clone
 * copies the (small, bounded — ADR-0004 rule 2) bytes safely instead.
 */
import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import { serialize as bsonSerialize } from 'bson'
import { serializeValue, extractFieldPaths } from './serialize-core'

type Op = 'serialize' | 'fields'

interface Pending {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
}

interface WorkerResponse {
  id: number
  ok: boolean
  result?: unknown
  error?: string
}

class SerializerPool {
  private worker: Worker | null = null
  private seq = 0
  private readonly pending = new Map<number, Pending>()
  /** True once the worker is known-unusable; all calls then go inline. */
  private broken = false

  private ensureWorker(): Worker | null {
    if (this.broken) return null
    if (this.worker) return this.worker
    try {
      const worker = new Worker(join(__dirname, 'serializer.worker.js'))
      worker.on('message', (msg: WorkerResponse) => this.onMessage(msg))
      worker.on('error', (err) => this.onFatal(err))
      worker.on('exit', (code) => {
        if (code !== 0) this.onFatal(new Error(`serializer worker exited with code ${code}`))
      })
      this.worker = worker
      return worker
    } catch {
      this.broken = true
      return null
    }
  }

  private onMessage(msg: WorkerResponse): void {
    const p = this.pending.get(msg.id)
    if (!p) return
    this.pending.delete(msg.id)
    if (msg.ok) p.resolve(msg.result)
    else p.reject(new Error(msg.error ?? 'serializer worker error'))
  }

  /** Worker died: reject everything in flight and degrade to inline forever. */
  private onFatal(err: Error): void {
    this.broken = true
    this.worker = null
    for (const p of this.pending.values()) p.reject(err)
    this.pending.clear()
  }

  private run(op: Op, items: Uint8Array[]): Promise<unknown> {
    const worker = this.ensureWorker()
    if (!worker) return Promise.reject(new Error('serializer worker unavailable'))
    const id = ++this.seq
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      worker.postMessage({ id, op, items })
    })
  }

  /** Serialize a batch of values to plain EJSON-canonical JSON, off-thread. */
  async serialize(values: unknown[]): Promise<unknown[]> {
    if (values.length === 0) return []
    try {
      const items = values.map((v) => bsonSerialize({ v }))
      return (await this.run('serialize', items)) as unknown[]
    } catch {
      return values.map(serializeValue)
    }
  }

  /** Serialize a single value (convenience over {@link serialize}). */
  async serializeOne(value: unknown): Promise<unknown> {
    return (await this.serialize([value]))[0]
  }

  /** Extract sorted, bounded dot-path field names from sampled docs, off-thread. */
  async extractFields(docs: unknown[]): Promise<string[]> {
    if (docs.length === 0) return []
    try {
      const items = docs.map((d) => bsonSerialize({ v: d }))
      return (await this.run('fields', items)) as string[]
    } catch {
      return extractFieldPaths(docs)
    }
  }

  /** Terminate the worker and reject anything still pending (called on quit). */
  dispose(): void {
    this.broken = true
    if (this.worker) {
      void this.worker.terminate()
      this.worker = null
    }
    for (const p of this.pending.values()) p.reject(new Error('serializer pool disposed'))
    this.pending.clear()
  }
}

export const serializerPool = new SerializerPool()
