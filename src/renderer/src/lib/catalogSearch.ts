import Fuse from 'fuse.js/basic'
import type { CatalogState } from '@renderer/store/useAppStore'

export type MatchRange = readonly [number, number]

export interface CatalogSearchEntry {
  id: string
  text: string
  detail?: string
}

export interface CatalogSearchMatch {
  text: MatchRange[]
  detail: MatchRange[]
  approximate: boolean
}

export interface CatalogSearchSnapshot {
  databases: { name: string }[]
  collections: Record<string, { name: string; type: 'collection' | 'view' | 'timeseries' }[]>
}

/** Keep namespace names for offline search, without live metadata or resources. */
export function catalogSearchSnapshot(catalog: CatalogState): CatalogSearchSnapshot {
  return {
    databases: (catalog.databases ?? []).map(({ name }) => ({ name })),
    collections: Object.fromEntries(
      Object.entries(catalog.collections).flatMap(([db, collections]) =>
        collections ? [[db, collections.map(({ name, type }) => ({ name, type }))]] : []
      )
    )
  }
}

function substringRanges(text: string, query: string): MatchRange[] {
  const normalized = text.toLocaleLowerCase()
  const ranges: MatchRange[] = []
  let start = normalized.indexOf(query)
  while (start !== -1) {
    ranges.push([start, start + query.length - 1])
    start = normalized.indexOf(query, start + query.length)
  }
  return ranges
}

export function createCatalogSearch(
  entries: CatalogSearchEntry[]
): (search: string) => Map<string, CatalogSearchMatch> {
  // Construct the fuzzy index only when a long query needs it, and reuse it
  // until the owning directory list changes.
  let fuse: Fuse<CatalogSearchEntry> | undefined
  return (search) => {
    const query = search.trim().toLocaleLowerCase()
    const matches = new Map<string, CatalogSearchMatch>()
    if (!query) return matches

    for (const entry of entries) {
      const text = substringRanges(entry.text, query)
      const detail = substringRanges(entry.detail ?? '', query)
      if (text.length || detail.length) matches.set(entry.id, { text, detail, approximate: false })
    }

    // Prefer literal results. Short queries never admit typos: a single error
    // in "ord" would also admit "products", obscuring the intended namespace.
    if (matches.size || Array.from(query).length < 4) return matches
    fuse ??= new Fuse(entries, {
      keys: ['text', 'detail'],
      includeMatches: true,
      ignoreLocation: true,
      ignoreFieldNorm: true,
      shouldSort: false,
      threshold: 0.35
    })
    for (const result of fuse.search(query)) {
      if (matches.has(result.item.id)) continue
      const text = result.matches?.find((match) => match.key === 'text')?.indices ?? []
      const detail = result.matches?.find((match) => match.key === 'detail')?.indices ?? []
      matches.set(result.item.id, { text: [...text], detail: [...detail], approximate: true })
    }
    return matches
  }
}
