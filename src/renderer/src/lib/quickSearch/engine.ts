import Fuse from 'fuse.js/basic'
import {
  SEARCH_GROUPS,
  SEARCH_PAGE_SIZE,
  yieldSearchTask,
  type SearchDocument,
  type SearchHit,
  type SearchRank,
  type SearchRequest,
  type SearchResult
} from './types'

interface IndexedDocument {
  doc: SearchDocument
  label: string
  detail: string
  code: string
}

export function compareSearchRank(a: SearchRank, b: SearchRank): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3] || a[4].localeCompare(b[4])
}

function preview(code: string, query: string): string {
  if (!code) return ''
  const at = query ? code.toLocaleLowerCase().indexOf(query) : -1
  const start = Math.max(0, at - 48)
  return `${start ? '…' : ''}${code
    .slice(start, start + 180)
    .replace(/\s+/g, ' ')
    .trim()}${code.length > start + 180 ? '…' : ''}`
}

/** Worker-owned index. Long code is never part of the fuzzy index. */
export class QuickSearchIndex {
  private documents = new Map<string, IndexedDocument>()
  private chunks:
    { entries: IndexedDocument[]; fuzzy?: Fuse<string>; owners?: Map<string, IndexedDocument[]> }[] | null =
    null

  async sync(upsert: SearchDocument[], remove: string[], cancelled = (): boolean => false): Promise<void> {
    for (const id of remove) this.documents.delete(id)
    let started = performance.now()
    for (const doc of upsert) {
      if (cancelled()) return
      this.documents.set(doc.id, {
        doc,
        label: doc.group === 'history' ? '' : doc.label.toLocaleLowerCase(),
        detail: (doc.searchDetail ?? doc.detail).toLocaleLowerCase(),
        code: (doc.code ?? '').toLocaleLowerCase()
      })
      if (performance.now() - started >= 4) {
        await yieldSearchTask()
        started = performance.now()
      }
    }
    this.chunks = null
  }

  async search(request: SearchRequest, cancelled = (): boolean => false): Promise<SearchResult | null> {
    const query = request.query.trim().toLocaleLowerCase()
    const visits = new Map(request.visits.map((v) => [v.id, v.at]))
    const visitedAt = (doc: SearchDocument): number =>
      Math.max(visits.get(doc.id) ?? 0, ...(doc.visitIds ?? []).map((id) => visits.get(id) ?? 0))
    const totals = Object.fromEntries(SEARCH_GROUPS.map((group) => [group, 0])) as SearchResult['totals']
    const buckets = new Map(
      SEARCH_GROUPS.map((group) => [group, [] as { entry: IndexedDocument; rank: SearchRank }[]])
    )
    const limit = request.scope === 'all' ? 3 : SEARCH_PAGE_SIZE + 1
    if (!this.chunks) {
      const chunks: NonNullable<QuickSearchIndex['chunks']> = []
      let entries: IndexedDocument[] = []
      for (const entry of this.documents.values()) {
        entries.push(entry)
        if (entries.length === 256) {
          chunks.push({ entries })
          entries = []
        }
      }
      if (entries.length) chunks.push({ entries })
      this.chunks = chunks
    }
    let started = performance.now()
    for (const chunk of this.chunks) {
      if (cancelled()) return null
      if (request.scope !== 'all' && !chunk.entries.some((entry) => entry.doc.group === request.scope))
        continue
      const literal = new Map<IndexedDocument, number>()
      for (const entry of chunk.entries) {
        if (request.scope !== 'all' && entry.doc.group !== request.scope) continue
        if (!query) {
          if (request.scope !== 'all' || visitedAt(entry.doc) > 0) literal.set(entry, 0)
        } else {
          const labelAt = entry.label.indexOf(query)
          if (entry.label === query) literal.set(entry, 0)
          else if (labelAt === 0) literal.set(entry, 1)
          else if (labelAt !== -1 || entry.detail.includes(query)) literal.set(entry, 2)
          else if (entry.code.includes(query)) literal.set(entry, 3)
        }
      }
      if (Array.from(query).length >= 4 && literal.size < chunk.entries.length) {
        if (!chunk.fuzzy) {
          // Many catalog children share the same connection/database context.
          // Match each distinct short field once, then fan out to its owners.
          const owners = new Map<string, IndexedDocument[]>()
          for (const entry of chunk.entries)
            for (const text of [entry.label, entry.detail]) {
              if (!text) continue
              const entries = owners.get(text)
              if (entries) entries.push(entry)
              else owners.set(text, [entry])
            }
          chunk.owners = owners
          chunk.fuzzy = new Fuse([...owners.keys()], {
            threshold: 0.35,
            ignoreLocation: true,
            ignoreFieldNorm: true,
            shouldSort: false
          })
        }
        for (const hit of chunk.fuzzy.search(query)) {
          for (const entry of chunk.owners!.get(hit.item)!) {
            if (!literal.has(entry) && (request.scope === 'all' || entry.doc.group === request.scope)) {
              literal.set(entry, 4)
            }
          }
        }
      }
      for (const [entry, tier] of literal) {
        const doc = entry.doc
        totals[doc.group]++
        const visitTime = visitedAt(doc)
        const rank: SearchRank = [
          tier,
          query && doc.connectionId === request.connectionId ? 0 : 1,
          visitTime ? 0 : 1,
          -(visitTime || doc.updatedAt || 0),
          doc.id
        ]
        if (request.after && compareSearchRank(rank, request.after) <= 0) continue
        const bucket = buckets.get(doc.group)!
        // Retain only the current page (or the three overview hits), not all matches.
        if (bucket.length === limit && compareSearchRank(rank, bucket.at(-1)!.rank) >= 0) continue
        let index = bucket.findIndex((item) => compareSearchRank(rank, item.rank) < 0)
        if (index === -1) index = bucket.length
        bucket.splice(index, 0, { entry, rank })
        if (bucket.length > limit) bucket.pop()
      }
      if (performance.now() - started >= 4) {
        await yieldSearchTask()
        started = performance.now()
      }
    }
    if (cancelled()) return null
    const hits: SearchHit[] = []
    let more = false
    for (const group of SEARCH_GROUPS) {
      const bucket = buckets.get(group)!
      if (request.scope !== 'all' && bucket.length > SEARCH_PAGE_SIZE) {
        more = true
        bucket.pop()
      }
      for (const { entry, rank } of bucket) {
        const doc = entry.doc
        hits.push({
          id: doc.id,
          group,
          label: doc.label,
          icon: doc.icon,
          detail: doc.detail,
          preview: preview(doc.code ?? '', rank[0] === 3 ? query : ''),
          approximate: rank[0] === 4,
          count: doc.count,
          rank
        })
      }
    }
    return { query: request.query, scope: request.scope, hits, totals, more }
  }
}
