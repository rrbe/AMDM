/**
 * Pure helpers for the multi-tab query workspace. The store holds `tabs` +
 * `activeTabId`; each tab carries its own editor code, run state, and a strip
 * of result tabs (one per run, capped) so runs are independent and several
 * outcomes can be compared side by side.
 * Keeping the list/label logic here (no store, no React) makes it unit-testable.
 */
import type { ShellResult } from '@shared/types'

/** The query that produced a result (refresh / paging / doc-edit target). */
export interface ResultQuery {
  connectionId: string
  database: string
  code: string
}

/** One entry in a tab's result strip: a run outcome plus its paging state. */
export interface ResultTab {
  id: string
  /** 1-based run sequence within its query tab (drives the "结果 N" label).
      Monotonic — eviction of old results never renumbers survivors. */
  seq: number
  result: ShellResult
  /** Query that produced `result`; refresh/paging/doc edits re-run this. */
  query: ResultQuery | null
  /** Page offset of the current result page (0 = first page). */
  skip: number
}

/** Upper bound on kept results per tab; the oldest is evicted when a new run
    lands (ADR-0004 rule 6 — results hold up to a full page of EJSON docs). */
export const MAX_RESULT_TABS = 8

export interface QueryTab {
  id: string
  /** Per-tab active database (the db selector is scoped to the tab). */
  activeDatabase: string
  code: string
  /** True while `code` is blank or a programmatic fill (browse seed, loaded
      query) the user hasn't edited. Only pristine tabs may be refilled in
      place; anything the user typed gets a tab of its own. Cleared by the
      editor's onChange (user keystrokes only — external value syncs don't
      fire it), never set back. */
  pristine: boolean
  /** Result strip: one entry per run, newest last, capped at MAX_RESULT_TABS. */
  results: ResultTab[]
  /** Focused result tab id (null = nothing has run yet). */
  activeResultId: string | null
  /** Monotonic run counter feeding ResultTab.seq. */
  resultSeq: number
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
    pristine: true,
    results: [],
    activeResultId: null,
    resultSeq: 0,
    running: false,
    runningExecId: null,
    ...init
  }
}

/**
 * Where a programmatic editor fill (browse-collection seed, saved query or
 * history load) should land without clobbering user work:
 * - `focusId`: a tab already holds exactly this fill — just focus it.
 * - `reuseId`: the active tab is still pristine and has no results — refill it
 *   in place (so clicking through the catalog doesn't spray tabs).
 * - neither: the caller opens a fresh tab.
 */
export function pickFillTarget(
  tabs: QueryTab[],
  activeTabId: string,
  match?: { database: string; code: string }
): { focusId?: string; reuseId?: string } {
  if (match) {
    const existing = tabs.find((t) => t.activeDatabase === match.database && t.code === match.code)
    if (existing) return { focusId: existing.id }
  }
  const active = tabs.find((t) => t.id === activeTabId)
  if (active?.pristine && active.results.length === 0) return { reuseId: active.id }
  return {}
}

/** Immutably patch one tab by id (others keep identity → stable selectors). */
export function patchTab(tabs: QueryTab[], id: string, patch: Partial<QueryTab>): QueryTab[] {
  return tabs.map((t) => (t.id === id ? { ...t, ...patch } : t))
}

/**
 * Which tab id should become active after `closeId` is removed. Returns the
 * left neighbor (else the right) when the closed tab was active; otherwise the
 * current active id is preserved. `undefined` when nothing would remain.
 * Generic over `{ id }` so it serves both query tabs and result tabs.
 */
export function pickActiveAfterClose<T extends { id: string }>(
  tabs: T[],
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

// ---------------------------------------------------------------------------
// Result strip helpers — every run appends a result tab; paging/refresh patch
// the focused one in place. All return Partial<QueryTab> for use with patchTab.
// ---------------------------------------------------------------------------

/** The focused result tab of `tab`, or null when nothing has run yet. */
export function activeResult(tab: QueryTab): ResultTab | null {
  return tab.results.find((r) => r.id === tab.activeResultId) ?? null
}

/** Append a new run's result as a fresh, focused result tab (evicting the
    oldest beyond `max`). */
export function appendResult(
  tab: QueryTab,
  id: string,
  result: ShellResult,
  query: ResultQuery | null,
  max = MAX_RESULT_TABS
): Partial<QueryTab> {
  const seq = tab.resultSeq + 1
  const results = [...tab.results, { id, seq, result, query, skip: 0 }]
  return {
    results: results.length > max ? results.slice(results.length - max) : results,
    activeResultId: id,
    resultSeq: seq
  }
}

/** Immutably patch one result tab by id (no-op shape when the id is absent —
    e.g. the tab was closed while its page load was in flight). */
export function patchResult(
  tab: QueryTab,
  resultId: string,
  patch: Partial<ResultTab>
): Partial<QueryTab> {
  return { results: tab.results.map((r) => (r.id === resultId ? { ...r, ...patch } : r)) }
}

/** Close one result tab, moving focus to a neighbor when it was active. */
export function closeResult(tab: QueryTab, resultId: string): Partial<QueryTab> {
  const results = tab.results.filter((r) => r.id !== resultId)
  if (results.length === tab.results.length) return {}
  const next = tab.activeResultId
    ? pickActiveAfterClose(tab.results, tab.activeResultId, resultId)
    : undefined
  return { results, activeResultId: next ?? null }
}

/** Short display label for a result tab: target collection (or result kind)
    plus the run sequence, e.g. "orders 3" / "Explain 2" / "结果 1". */
export function resultTabLabel(rt: ResultTab): string {
  if (rt.result.kind === 'explain') return `Explain ${rt.seq}`
  if (rt.result.kind === 'error') return `错误 ${rt.seq}`
  const coll = rt.result.collection
  return coll ? `${coll} ${rt.seq}` : `结果 ${rt.seq}`
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
