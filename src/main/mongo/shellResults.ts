import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FindCursor, type Document, type FindOptions, type MongoClient } from 'mongodb'
import type { ShellResult, ShellResultTotal } from '../../shared/types'
import { serializerPool } from '../workers/serializerPool'
import { withAbort } from './shellSupport'

interface ResultCursor {
  hasNext(): Promise<boolean>
  next(): Promise<unknown>
  close(): Promise<void>
}

const CHUNK_SIZE = 50
const READ_TIMEOUT_MS = 30_000

/** A single execution's cursor and disk-backed pages. Only the requested page
 * crosses IPC; visiting a page never evaluates the user's script again. */
export class ShellResultSession {
  readonly id = randomUUID()
  private directory?: string
  private chunks: { from: number; count: number; path: string }[] = []
  private loaded = 0
  private cursor?: ResultCursor
  private exhausted = false
  private closed = false
  private failure?: unknown
  private reading: Promise<unknown> = Promise.resolve()
  private counting?: Promise<void>
  private cleanup?: () => Promise<void>
  private total: ShellResultTotal = { totalStatus: 'unknown' }

  constructor(
    readonly connectionId: string,
    readonly ownerId: number,
    readonly controller: AbortController,
    private timeoutMS: number
  ) {}

  get retainsCursor(): boolean {
    return !!this.cursor
  }

  retainCleanup(cleanup: () => Promise<void>): void {
    this.cleanup = cleanup
  }

  async capture(value: unknown[] | ResultCursor, nativeFind?: FindCursor): Promise<void> {
    const capturing = this.reading.then(() => this.captureValue(value, nativeFind))
    this.reading = capturing.catch(() => {})
    return capturing
  }

  private async captureValue(value: unknown[] | ResultCursor, nativeFind?: FindCursor): Promise<void> {
    if (this.closed) throw new Error('Result is closed')
    if (Array.isArray(value)) {
      for (let from = 0; from < value.length; from += CHUNK_SIZE) {
        await this.append(value.slice(from, from + CHUNK_SIZE))
      }
      this.exhausted = true
      this.total = { totalStatus: 'known', totalCount: this.loaded }
    } else {
      this.cursor = value
      if (nativeFind && !nativeFind.id) this.countFind(nativeFind)
    }
  }

  private countFind(cursor: FindCursor): void {
    // The pinned Driver stores the original filter/options here. Do not parse
    // or rerun arbitrary Shell code to reconstruct a count query.
    const { cursorFilter, findOptions, client } = cursor as unknown as {
      cursorFilter: Document
      findOptions: FindOptions
      client: MongoClient
    }
    if (findOptions.min || findOptions.max || findOptions.tailable || findOptions.session?.inTransaction()) return
    this.total = { totalStatus: 'counting' }
    const signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(READ_TIMEOUT_MS)])
    this.counting = client.db(cursor.namespace.db).collection(cursor.namespace.collection!).countDocuments(
      cursorFilter,
      {
        ...(findOptions.skip ? { skip: findOptions.skip } : {}),
        ...(findOptions.limit ? { limit: Math.abs(findOptions.limit) } : {}),
        collation: findOptions.collation,
        hint: findOptions.hint,
        readConcern: cursor.readConcern,
        readPreference: cursor.readPreference,
        maxTimeMS: Math.min(this.timeoutMS || READ_TIMEOUT_MS, READ_TIMEOUT_MS),
        signal
      }
    ).then(
      (totalCount) => {
        if (!this.exhausted && !this.closed) this.total = { totalStatus: 'known', totalCount }
      },
      () => {
        if (!this.exhausted && !this.closed) this.total = { totalStatus: 'unavailable' }
      }
    )
  }

  async getTotal(): Promise<ShellResultTotal> {
    if (this.total.totalStatus === 'counting') await this.counting
    return this.total
  }

  private async append(documents: unknown[]): Promise<void> {
    if (this.closed) throw new Error('Result is closed')
    this.directory ??= await mkdtemp(join(tmpdir(), 'amdm-result-'))
    const data = await withAbort(serializerPool.serialize(documents), this.controller.signal)
    const path = join(this.directory, `${this.chunks.length}.json`)
    await writeFile(path, JSON.stringify(data), { mode: 0o600, signal: this.controller.signal })
    this.chunks.push({ from: this.loaded, count: documents.length, path })
    this.loaded += documents.length
  }

  private async finishCursor(): Promise<void> {
    const cursor = this.cursor
    this.cursor = undefined
    try {
      await cursor?.close()
    } finally {
      const cleanup = this.cleanup
      this.cleanup = undefined
      await cleanup?.()
    }
  }

  async page(skip: number, pageSize: number): Promise<ShellResult> {
    // A cursor cannot be advanced by concurrent page requests.
    const reading = this.reading.then(() => this.readPage(skip, pageSize))
    this.reading = reading.catch(() => {})
    return reading
  }

  private async readPage(skip: number, pageSize: number): Promise<ShellResult> {
    if (this.closed) throw new Error('Result is closed. Run the query again.')
    if (skip > this.loaded) throw new Error('Page offset exceeds loaded results')
    const end = skip + pageSize
    if (!this.exhausted && this.loaded < end) {
      if (this.failure) throw this.failure
      const timer = setTimeout(() => this.controller.abort(new DOMException('Result reading timed out', 'TimeoutError')), this.timeoutMS || READ_TIMEOUT_MS)
      try {
        while (this.cursor && this.loaded < end) {
          const documents: unknown[] = []
          while (documents.length < Math.min(CHUNK_SIZE, end - this.loaded) && await withAbort(this.cursor.hasNext(), this.controller.signal)) {
            documents.push(await withAbort(this.cursor.next(), this.controller.signal))
          }
          if (documents.length) await this.append(documents)
          if (!await withAbort(this.cursor.hasNext(), this.controller.signal)) {
            this.exhausted = true
            this.total = { totalStatus: 'known', totalCount: this.loaded }
            await this.finishCursor()
          }
        }
      } catch (error) {
        this.failure = error
        await this.finishCursor()
        throw error
      } finally {
        clearTimeout(timer)
      }
    }
    const documents: unknown[] = []
    for (const chunk of this.chunks) {
      if (chunk.from >= end) break
      if (chunk.from + chunk.count <= skip) continue
      const data = JSON.parse(await readFile(chunk.path, 'utf8')) as unknown[]
      documents.push(...data.slice(Math.max(0, skip - chunk.from), end - chunk.from))
    }
    return {
      kind: 'documents', data: documents, count: documents.length,
      resultId: this.id, pageSize, skip, pageable: true,
      truncated: !this.exhausted || end < this.loaded,
      ...this.total
    }
  }

  async close(): Promise<void> {
    this.closed = true
    this.controller.abort(new Error('Result is closed'))
    await this.reading
    await this.finishCursor()
    await this.counting
    if (this.directory) await rm(this.directory, { recursive: true, force: true })
    this.chunks = []
  }
}

class ShellResults {
  private results = new Map<string, ShellResultSession>()

  create(connectionId: string, ownerId: number, controller: AbortController, timeoutMS: number): ShellResultSession {
    const result = new ShellResultSession(connectionId, ownerId, controller, timeoutMS)
    this.results.set(result.id, result)
    return result
  }

  get(id: string, ownerId: number): ShellResultSession {
    const result = this.results.get(id)
    if (!result || result.ownerId !== ownerId) throw new Error('Result is closed. Run the query again.')
    return result
  }

  async release(id: string, ownerId: number): Promise<void> {
    const result = this.results.get(id)
    if (!result || result.ownerId !== ownerId) return
    this.results.delete(id)
    await result.close()
  }

  async closeConnection(connectionId: string): Promise<void> {
    await Promise.all([...this.results.values()].filter((r) => r.connectionId === connectionId).map((r) => this.release(r.id, r.ownerId)))
  }

  async closeOwner(ownerId: number): Promise<void> {
    await Promise.all([...this.results.values()].filter((r) => r.ownerId === ownerId).map((r) => this.release(r.id, ownerId)))
  }
}

export const shellResults = new ShellResults()
