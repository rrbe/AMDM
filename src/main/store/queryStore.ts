import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { HistoryEntry, SavedQuery, SavedQueryInput } from '../../shared/types'

const HISTORY_CAP = 200

interface QueryFile {
  version: 1
  queries: SavedQuery[]
  history: HistoryEntry[]
}

/** Persists saved queries + execution history to a JSON file in userData. */
class QueryStore {
  private filePath = ''
  private data: QueryFile = { version: 1, queries: [], history: [] }

  init(): void {
    this.filePath = join(app.getPath('userData'), 'queries.json')
    if (existsSync(this.filePath)) {
      try {
        const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<QueryFile>
        this.data = {
          version: 1,
          queries: parsed.queries ?? [],
          history: parsed.history ?? []
        }
      } catch {
        this.data = { version: 1, queries: [], history: [] }
      }
    }
  }

  private persist(): void {
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8')
  }

  // --- saved queries ---
  listQueries(): SavedQuery[] {
    return this.data.queries
  }

  saveQuery(input: SavedQueryInput): SavedQuery {
    const now = Date.now()
    const id = input.id || randomUUID()
    const existing = this.data.queries.find((q) => q.id === id)
    const q: SavedQuery = {
      id,
      name: input.name,
      code: input.code,
      connectionId: input.connectionId,
      database: input.database,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    }
    const idx = this.data.queries.findIndex((x) => x.id === id)
    if (idx >= 0) this.data.queries[idx] = q
    else this.data.queries.push(q)
    this.persist()
    return q
  }

  deleteQuery(id: string): void {
    this.data.queries = this.data.queries.filter((q) => q.id !== id)
    this.persist()
  }

  // --- history ---
  listHistory(): HistoryEntry[] {
    return this.data.history
  }

  addHistory(entry: {
    code: string
    connectionId: string
    database: string
    ok: boolean
    summary?: string
  }): void {
    const item: HistoryEntry = {
      id: randomUUID(),
      ranAt: Date.now(),
      ...entry
    }
    // Newest first, capped.
    this.data.history.unshift(item)
    if (this.data.history.length > HISTORY_CAP) {
      this.data.history.length = HISTORY_CAP
    }
    this.persist()
  }

  clearHistory(): void {
    this.data.history = []
    this.persist()
  }
}

export const queryStore = new QueryStore()
