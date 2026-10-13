export const SEARCH_GROUPS = ['connections', 'queries', 'data', 'saved', 'history'] as const
export type SearchGroup = (typeof SEARCH_GROUPS)[number]
export type SearchScope = SearchGroup | 'all'

export interface SearchDocument {
  id: string
  group: SearchGroup
  label: string
  icon?: string
  detail: string
  searchDetail?: string
  code?: string
  connectionId?: string
  updatedAt?: number
  count?: number
  visitIds?: string[]
}

export interface SearchVisit {
  id: string
  at: number
}

export type SearchRank = [number, number, number, number, string]
export interface SearchHit {
  id: string
  group: SearchGroup
  label: string
  icon?: string
  detail: string
  preview: string
  approximate: boolean
  count?: number
  rank: SearchRank
}

export interface SearchRequest {
  query: string
  scope: SearchScope
  connectionId: string | null
  visits: SearchVisit[]
  after?: SearchRank
}

export interface SearchResult {
  query: string
  scope: SearchScope
  hits: SearchHit[]
  totals: Record<SearchGroup, number>
  more: boolean
}

export type SearchWorkerRequest =
  | { type: 'sync'; upsert: SearchDocument[]; remove: string[] }
  | { type: 'search'; seq: number; request: SearchRequest }
  | { type: 'cancel' }

export type SearchWorkerResponse = { seq: number; result?: SearchResult; error?: string }
export const SEARCH_PAGE_SIZE = 100

export function searchId(group: SearchGroup, id: string): string {
  return JSON.stringify([group, id])
}

/** Yield through a new task, without the nested-timer 4ms clamp. */
export function yieldSearchTask(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    channel.port1.onmessage = () => {
      channel.port1.close()
      channel.port2.close()
      resolve()
    }
    channel.port2.postMessage(null)
  })
}
