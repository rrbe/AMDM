/**
 * Pure helpers for the multi-tab query workspace. The store holds `tabs` +
 * `activeTabId`; each tab carries its own editor code, result, paging, and
 * run state so tabs are independent (one can run while another is edited).
 * Keeping the list/label logic here (no store, no React) makes it unit-testable.
 */
import type { ShellResult } from '@shared/types'

export interface QueryTab {
  id: string
  /** Per-tab active database (the db selector is scoped to the tab). */
  activeDatabase: string
  code: string
  result: ShellResult | null
  /** The query that produced `result` (for refresh after doc edit/delete). */
  lastQuery: { connectionId: string; database: string; code: string } | null
  /** Page offset of the current result (0 = first page). */
  resultSkip: number
  running: boolean
  /** execId of this tab's in-flight run, for Stop / cleanup on close. */
  runningExecId: string | null
}

/** A fresh, empty tab. `id` is injected so callers control id generation. */
export function createTab(id: string, init: Partial<QueryTab> = {}): QueryTab {
  return {
    id,
    activeDatabase: '',
    code: '',
    result: null,
    lastQuery: null,
    resultSkip: 0,
    running: false,
    runningExecId: null,
    ...init
  }
}

/** Immutably patch one tab by id (others keep identity → stable selectors). */
export function patchTab(tabs: QueryTab[], id: string, patch: Partial<QueryTab>): QueryTab[] {
  return tabs.map((t) => (t.id === id ? { ...t, ...patch } : t))
}

/**
 * Which tab id should become active after `closeId` is removed. Returns the
 * left neighbor (else the right) when the closed tab was active; otherwise the
 * current active id is preserved. `undefined` when nothing would remain.
 */
export function pickActiveAfterClose(
  tabs: QueryTab[],
  activeId: string,
  closeId: string
): string | undefined {
  if (activeId !== closeId) return activeId
  const idx = tabs.findIndex((t) => t.id === closeId)
  const remaining = tabs.filter((t) => t.id !== closeId)
  if (remaining.length === 0) return undefined
  // Prefer the previous tab, falling back to the one that shifts into its place.
  const prev = tabs[idx - 1]
  if (prev && remaining.some((t) => t.id === prev.id)) return prev.id
  return remaining[Math.min(idx, remaining.length - 1)].id
}

/** Short display label for a tab: the targeted collection, else "查询 N". */
export function tabLabel(tab: QueryTab, index: number): string {
  // Order matters: match `getCollection("x")` and `db["x"]` BEFORE the generic
  // `db.<name>` (else `.getCollection` is captured as the name).
  const m =
    /\bdb\s*(?:\.\s*getCollection\(\s*['"]([^'"]+)['"]\s*\)|\[\s*['"]([^'"]+)['"]\s*\]|\.\s*([A-Za-z_$][\w$]*))/.exec(
      tab.code
    )
  const coll = m?.[1] ?? m?.[2] ?? m?.[3]
  const reserved = new Set(['getCollection', 'getSiblingDB', 'runCommand', 'adminCommand'])
  if (coll && !reserved.has(coll)) return coll
  return `查询 ${index + 1}`
}
